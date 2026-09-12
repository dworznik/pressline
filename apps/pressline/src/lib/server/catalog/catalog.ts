import {
  PrintfileSpec,
  PROTOCOL_VERSION,
  specHash,
  type CatalogOffer,
  type CatalogResponse,
  type OfferVariant,
} from '@pressline/contract';
import { Clock, Effect, Schema } from 'effect';
import { Config, type OfferConfig, type OfferVariantConfig } from '../config/schema';
import { Db } from '../db/db';
import {
  FulfillmentProvider,
  samePrintMethod,
  type CatalogVariant,
  type FulfillmentProviderError,
  type PlacementPrintArea,
} from '../services/fulfillment-provider';

/**
 * The Catalog (CONTEXT.md, ADR-0006, ADR-0010): Operator-configured Offers
 * resolved against the fulfillment provider into Printfile Specs. What the
 * provider said about a variant is cached with a TTL; what the Operator
 * configured is applied on every read, so a config change is live on
 * redeploy and never waits for the cache.
 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** The Operator's config disagrees with the provider's catalog. */
export class CatalogError extends Schema.TaggedError<CatalogError>()('CatalogError', {
  offer: Schema.String,
  message: Schema.String,
}) {}

/**
 * Techniques that print onto the product's own surface (garment, cap) accept
 * transparency; everything else (paper, sublimation, all-over) needs an opaque
 * file. `required` is never derived: a design may always choose a solid
 * background where alpha is merely allowed.
 */
const TRANSPARENT_TECHNIQUES = new Set(['dtg', 'dtfilm', 'embroidery', 'uv']);
const alphaFor = (technique: string): PrintfileSpec['alpha'] =>
  TRANSPARENT_TECHNIQUES.has(technique) ? 'allowed' : 'forbidden';

/** Derive the Printfile Spec: print area inches × DPI, rounded to whole pixels. */
export const deriveSpec = (
  offer: Pick<OfferConfig, 'slug' | 'placement' | 'technique'>,
  variant: CatalogVariant,
  area: PlacementPrintArea,
): Effect.Effect<PrintfileSpec, CatalogError> => {
  const dims = variant.placementDimensions.find((d) => d.placement === offer.placement);
  const widthIn = dims?.widthIn ?? area.printAreaWidthIn;
  const heightIn = dims?.heightIn ?? area.printAreaHeightIn;
  const width = Math.round(widthIn * area.dpi);
  const height = Math.round(heightIn * area.dpi);
  const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (!positiveInt(width) || !positiveInt(height) || !positiveInt(area.dpi)) {
    return new CatalogError({
      offer: offer.slug,
      message: `provider returned invalid print dimensions (${widthIn}in × ${heightIn}in at ${area.dpi} dpi) for placement "${offer.placement}" on variant ${variant.id}`,
    });
  }
  const alpha = alphaFor(offer.technique);
  return Effect.succeed({
    width,
    height,
    dpi: area.dpi,
    formats: alpha === 'forbidden' ? ['png', 'jpeg'] : ['png'],
    colorSpace: 'srgb',
    alpha,
    placement: offer.placement,
    technique: offer.technique,
  });
};

/** What the provider told us about one variant, as persisted in `catalog_cache`. */
const CachedVariant = Schema.Struct({
  spec: PrintfileSpec,
  specHash: Schema.String,
  color: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  imageUrl: Schema.optional(Schema.String),
});
type CachedVariant = typeof CachedVariant.Type;
const CachedVariantJson = Schema.parseJson(CachedVariant);

/** Everything the cached value was derived from; a config change to any of it is a miss. */
const cacheKey = (offer: OfferConfig, catalogVariantId: number) =>
  `product:${offer.catalogProductId}:variant:${catalogVariantId}:${offer.placement}:${offer.technique}`;

// A broken cache table is infrastructure, not a domain error, hence orDie.
const readCache = (key: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* db.all<{ value: string }>(
      'SELECT value FROM catalog_cache WHERE key = ? AND expires_at > ?',
      [key, now],
    );
    return rows[0] ? yield* Schema.decode(CachedVariantJson)(rows[0].value) : undefined;
  }).pipe(Effect.orDie);

const writeCache = (key: string, value: CachedVariant) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    const json = yield* Schema.encode(CachedVariantJson)(value);
    yield* db.run(
      'INSERT OR REPLACE INTO catalog_cache (key, value, expires_at) VALUES (?, ?, ?)',
      [key, json, now + CACHE_TTL_MS],
    );
  }).pipe(Effect.orDie);

/** Config wins over the provider for presentation fields; the Spec is always the provider's. */
const presentVariant = (
  key: string,
  configured: OfferVariantConfig,
  cached: CachedVariant,
): OfferVariant => {
  const color = configured.color ?? cached.color;
  const size = configured.size ?? cached.size;
  const imageUrl = configured.imageUrl ?? cached.imageUrl;
  return {
    key,
    label: configured.label,
    ...(color !== undefined ? { color } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    spec: cached.spec,
    specHash: cached.specHash,
  };
};

/** Product-level facts needed for every cache miss of one Offer; fetched at most once per resolution. */
const printAreaFor = (offer: OfferConfig) =>
  Effect.gen(function* () {
    const provider = yield* FulfillmentProvider;
    const product = yield* provider.getCatalogProduct(offer.catalogProductId);
    if (!product.printMethods.some((m) => samePrintMethod(m, offer))) {
      return yield* new CatalogError({
        offer: offer.slug,
        message: `product ${product.id} (${product.name}) has no placement "${offer.placement}" with technique "${offer.technique}"`,
      });
    }
    const areas = yield* provider.getPlacementPrintAreas(offer.catalogProductId);
    const area = areas.find((a) => samePrintMethod(a, offer));
    if (!area) {
      return yield* new CatalogError({
        offer: offer.slug,
        message: `provider has no print area for placement "${offer.placement}" / "${offer.technique}" on product ${offer.catalogProductId}`,
      });
    }
    return area;
  });

const resolveVariant = (
  offer: OfferConfig,
  key: string,
  configured: OfferVariantConfig,
  printArea: Effect.Effect<
    PlacementPrintArea,
    CatalogError | FulfillmentProviderError,
    FulfillmentProvider
  >,
) =>
  Effect.gen(function* () {
    const provider = yield* FulfillmentProvider;
    const area = yield* printArea;
    const variant = yield* provider.getCatalogVariant(configured.catalogVariantId);
    if (variant.catalogProductId !== offer.catalogProductId) {
      return yield* new CatalogError({
        offer: offer.slug,
        message: `variant "${key}" (${configured.catalogVariantId}) belongs to product ${variant.catalogProductId}, not ${offer.catalogProductId}`,
      });
    }
    const spec = yield* deriveSpec(offer, variant, area);
    const hash = yield* specHash(spec).pipe(Effect.orDie); // derived specs are integral by construction
    const cached: CachedVariant = {
      spec,
      specHash: hash,
      ...(variant.color !== undefined ? { color: variant.color } : {}),
      ...(variant.size !== undefined ? { size: variant.size } : {}),
      ...(variant.imageUrl !== undefined ? { imageUrl: variant.imageUrl } : {}),
    };
    return cached;
  });

/** Resolve one Offer's variants, hitting the provider only for cache misses. */
const resolveOffer = (offer: OfferConfig, currency: string) =>
  Effect.gen(function* () {
    const printArea = yield* Effect.cached(printAreaFor(offer));
    const variants: OfferVariant[] = [];
    for (const [key, configured] of Object.entries(offer.variants)) {
      const cacheId = cacheKey(offer, configured.catalogVariantId);
      let cached = yield* readCache(cacheId);
      if (!cached) {
        cached = yield* resolveVariant(offer, key, configured, printArea);
        yield* writeCache(cacheId, cached);
      }
      variants.push(presentVariant(key, configured, cached));
    }
    const resolved: CatalogOffer = {
      slug: offer.slug,
      name: offer.name,
      placement: offer.placement,
      technique: offer.technique,
      retailPrice: { amount: offer.retailPrice, currency },
      aspect: offer.aspect ?? null,
      variants,
    };
    return resolved;
  });

/** The whole public Catalog. */
export const resolveCatalog: Effect.Effect<
  CatalogResponse,
  CatalogError | FulfillmentProviderError,
  Config | Db | FulfillmentProvider
> = Effect.gen(function* () {
  const config = yield* Config;
  const offers = yield* Effect.forEach(config.catalog.offers, (o) =>
    resolveOffer(o, config.currency),
  );
  return { protocolVersion: PROTOCOL_VERSION, currency: config.currency, offers };
});
