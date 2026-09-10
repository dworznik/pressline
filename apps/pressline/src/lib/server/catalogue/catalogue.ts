import {
  specHash,
  type CatalogueOffer,
  type CatalogueResponse,
  type CatalogueVariant,
  type PrintfileSpec,
} from '@pressline/contract';
import { Clock, Effect, Schema } from 'effect';
import { Config, type OfferConfig } from '../config/schema';
import { Db } from '../db/db';
import { PROTOCOL_VERSION } from '../http/api';
import type { ProviderError } from '../services/fulfilment-provider';
import {
  FulfilmentProvider,
  type CatalogVariant,
  type PlacementPrintArea,
} from '../services/fulfilment-provider';

/**
 * The Catalogue (CONTEXT.md, ADR-0006, ADR-0010): Operator-configured Offers
 * resolved against the fulfilment provider into Printfile Specs. Resolution
 * is cached per variant with a TTL so serving `GET /api/offers` normally
 * makes no provider calls.
 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** The Operator's config disagrees with the provider's catalog. */
export class CatalogueError extends Schema.TaggedError<CatalogueError>()('CatalogueError', {
  offer: Schema.String,
  message: Schema.String,
}) {}

const alphaFor = (technique: string): PrintfileSpec['alpha'] =>
  ['dtg', 'dtfilm', 'embroidery', 'uv'].includes(technique) ? 'allowed' : 'forbidden';

/** Derive the Printfile Spec: print area inches × DPI, rounded to whole pixels. */
export const deriveSpec = (
  offer: OfferConfig,
  variant: CatalogVariant,
  area: PlacementPrintArea,
): Effect.Effect<PrintfileSpec, CatalogueError> => {
  const dims = variant.placementDimensions.find((d) => d.placement === offer.placement);
  const widthIn = dims?.widthIn ?? area.printAreaWidthIn;
  const heightIn = dims?.heightIn ?? area.printAreaHeightIn;
  const alpha = alphaFor(offer.technique);
  if (!(widthIn > 0 && heightIn > 0 && area.dpi > 0)) {
    return new CatalogueError({
      offer: offer.slug,
      message: `provider returned no print dimensions for placement "${offer.placement}" on variant ${variant.id}`,
    });
  }
  return Effect.succeed({
    width: Math.round(widthIn * area.dpi),
    height: Math.round(heightIn * area.dpi),
    dpi: area.dpi,
    formats: alpha === 'forbidden' ? ['png', 'jpeg'] : ['png'],
    colorSpace: 'srgb',
    alpha,
    placement: offer.placement,
    technique: offer.technique,
  });
};

const cacheKey = (offer: OfferConfig, catalogVariantId: number) =>
  `variant:${catalogVariantId}:${offer.placement}:${offer.technique}`;

const readCache = (key: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* db.all<{ value: string }>(
      'SELECT value FROM catalogue_cache WHERE key = ? AND expires_at > ?',
      [key, now],
    );
    return rows[0] ? (JSON.parse(rows[0].value) as CatalogueVariant) : undefined;
  }).pipe(Effect.orDie); // a broken cache table is infrastructure, not a domain error

const writeCache = (key: string, value: CatalogueVariant) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    yield* db.run(
      'INSERT OR REPLACE INTO catalogue_cache (key, value, expires_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(value), now + CACHE_TTL_MS],
    );
  }).pipe(Effect.orDie);

/** Resolve one Offer's variants, hitting the provider only for cache misses. */
const resolveOffer = (offer: OfferConfig, currency: string) =>
  Effect.gen(function* () {
    const provider = yield* FulfilmentProvider;
    const entries = Object.entries(offer.variants);
    const variants: CatalogueVariant[] = [];
    // Product-level lookups are shared across this Offer's cache misses.
    let area: PlacementPrintArea | undefined;
    const productContext = Effect.cached(
      Effect.gen(function* () {
        const product = yield* provider.getCatalogProduct(offer.catalogProductId);
        const supported = product.placements.some(
          (p) => p.placement === offer.placement && p.technique === offer.technique,
        );
        if (!supported) {
          return yield* new CatalogueError({
            offer: offer.slug,
            message: `product ${product.id} (${product.name}) has no placement "${offer.placement}" with technique "${offer.technique}"`,
          });
        }
        const areas = yield* provider.getPlacementPrintAreas(offer.catalogProductId);
        const found = areas.find(
          (a) => a.placement === offer.placement && a.technique === offer.technique,
        );
        if (!found) {
          return yield* new CatalogueError({
            offer: offer.slug,
            message: `provider has no print area for placement "${offer.placement}" / "${offer.technique}" on product ${offer.catalogProductId}`,
          });
        }
        return found;
      }),
    );

    for (const [key, v] of entries) {
      const ck = cacheKey(offer, v.catalogVariantId);
      const cached = yield* readCache(ck);
      if (cached) {
        variants.push({ ...cached, key, label: v.label });
        continue;
      }
      area = yield* yield* productContext;
      const variant = yield* provider.getCatalogVariant(v.catalogVariantId);
      if (variant.catalogProductId !== offer.catalogProductId) {
        return yield* new CatalogueError({
          offer: offer.slug,
          message: `variant "${key}" (${v.catalogVariantId}) belongs to product ${variant.catalogProductId}, not ${offer.catalogProductId}`,
        });
      }
      const spec = yield* deriveSpec(offer, variant, area);
      const resolved: CatalogueVariant = {
        key,
        label: v.label,
        ...((v.color ?? variant.color) ? { color: v.color ?? variant.color } : {}),
        ...((v.size ?? variant.size) ? { size: v.size ?? variant.size } : {}),
        ...((v.imageUrl ?? variant.imageUrl) ? { imageUrl: v.imageUrl ?? variant.imageUrl } : {}),
        spec,
        specHash: yield* Effect.promise(() => specHash(spec)),
      };
      yield* writeCache(ck, resolved);
      variants.push(resolved);
    }

    const resolvedOffer: CatalogueOffer = {
      slug: offer.slug,
      name: offer.name,
      placement: offer.placement,
      technique: offer.technique,
      retailPrice: { amount: offer.retailPrice, currency },
      aspect: offer.aspect ?? null,
      variants,
    };
    return resolvedOffer;
  });

/** The whole public Catalogue. */
export const resolveCatalogue: Effect.Effect<
  CatalogueResponse,
  CatalogueError | ProviderError,
  Config | Db | FulfilmentProvider
> = Effect.gen(function* () {
  const config = yield* Config;
  const offers = yield* Effect.forEach(config.catalogue.offers, (o) =>
    resolveOffer(o, config.currency),
  );
  return { protocolVersion: PROTOCOL_VERSION, currency: config.currency, offers };
});
