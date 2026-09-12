import { inspectPrintfile, PrintfileInspection, PrintfileSpec } from '@pressline/contract';
import { Effect, Schema } from 'effect';
import { deriveSpec, resolveCatalog } from '../catalog/catalog';
import { Config, type OfferConfig } from '../config/schema';
import { FulfillmentProvider } from '../services/fulfillment-provider';
import { Psp } from '../services/psp';

/**
 * Operator tools behind the CLI (ticket #16): catalog search and check,
 * webhook registration, Printfile check. Reads and idempotent set-ups only;
 * configuration itself stays in the config file (ADR-0014).
 */
export class ToolError extends Schema.TaggedError<ToolError>()('ToolError', {
  message: Schema.String,
}) {}

export const CatalogSearchQuery = Schema.Struct({ q: Schema.String });

export const CatalogSearchResult = Schema.Struct({
  products: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      name: Schema.String,
      /** One row per placement × technique, with the Printfile Spec Pressline would derive. */
      placements: Schema.Array(
        Schema.Struct({
          placement: Schema.String,
          technique: Schema.String,
          spec: Schema.NullOr(PrintfileSpec),
        }),
      ),
      variants: Schema.Array(
        Schema.Struct({
          id: Schema.Int,
          name: Schema.String,
          color: Schema.optional(Schema.String),
          size: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});
export type CatalogSearchResult = typeof CatalogSearchResult.Type;

export const SEARCH_LIMIT = 10;

/** Products whose name contains every word of the query, with variants and the Specs per print method. */
export const catalogSearch = (q: string) =>
  Effect.gen(function* () {
    const provider = yield* FulfillmentProvider;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = yield* provider.listCatalogProducts();
    const hits = all
      .filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
      .slice(0, SEARCH_LIMIT);
    const products = yield* Effect.forEach(hits, (product) =>
      Effect.gen(function* () {
        const variants = yield* provider.listCatalogVariants(product.id);
        const areas = yield* provider.getPlacementPrintAreas(product.id);
        const sample = variants[0];
        const placements = yield* Effect.forEach(product.printMethods, (m) =>
          Effect.gen(function* () {
            const area = areas.find(
              (a) => a.placement === m.placement && a.technique === m.technique,
            );
            const spec =
              sample && area
                ? yield* deriveSpec({ slug: `${product.id}`, ...m }, sample, area).pipe(
                    Effect.orElseSucceed(() => null),
                  )
                : null;
            return { ...m, spec };
          }),
        );
        return {
          id: product.id,
          name: product.name,
          placements,
          variants: variants.map((v) => ({
            id: v.id,
            name: v.name,
            ...(v.color ? { color: v.color } : {}),
            ...(v.size ? { size: v.size } : {}),
          })),
        };
      }),
    );
    return { products } satisfies CatalogSearchResult;
  });

const OfferCheck = Schema.Struct({
  slug: Schema.String,
  ok: Schema.Boolean,
  variants: Schema.Int,
  message: Schema.optional(Schema.String),
});
type OfferCheck = typeof OfferCheck.Type;

export const CatalogCheckResult = Schema.Struct({ offers: Schema.Array(OfferCheck) });
export type CatalogCheckResult = typeof CatalogCheckResult.Type;

/** Resolve every configured Offer on its own so one bad Offer does not hide the others. */
export const catalogCheck = Effect.gen(function* () {
  const config = yield* Config;
  const offers = yield* Effect.forEach(config.catalog.offers, (offer: OfferConfig) =>
    resolveCatalog.pipe(
      Effect.provideService(Config, { ...config, catalog: { offers: [offer] } }),
      Effect.map((c): OfferCheck => ({
        slug: offer.slug,
        ok: true,
        variants: c.offers[0]?.variants.length ?? 0,
      })),
      Effect.catchAll((e) =>
        Effect.succeed<OfferCheck>({
          slug: offer.slug,
          ok: false,
          variants: 0,
          message: e.message,
        }),
      ),
    ),
  );
  return { offers } satisfies CatalogCheckResult;
});

export const WebhookRegisterRequest = Schema.Struct({
  /** Public origin of this instance; defaults to `checkout.publicUrl`. */
  publicUrl: Schema.optional(Schema.String.pipe(Schema.pattern(/^https:\/\//))),
});

/** One provider's outcome. Each is attempted on its own: a failure at one never discards the other's once-shown secret. */
const Registration = Schema.Union(
  Schema.Struct({
    status: Schema.Literal('created', 'verified'),
    url: Schema.String,
    secret: Schema.optional(Schema.String),
    publicKey: Schema.optional(Schema.String),
  }),
  Schema.Struct({ status: Schema.Literal('failed'), url: Schema.String, message: Schema.String }),
);

export const WebhookRegisterResult = Schema.Struct({
  stripe: Registration,
  printful: Registration,
});
export type WebhookRegisterResult = typeof WebhookRegisterResult.Type;

/** Create or verify both webhook endpoints for this instance's public URL. */
export const webhooksRegister = (publicUrl: string | undefined) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const origin = (publicUrl ?? config.checkout.publicUrl)?.replace(/\/$/, '');
    if (!origin) {
      return yield* new ToolError({
        message: 'no public URL: pass --public-url or set checkout.publicUrl in the config',
      });
    }
    if (!origin.startsWith('https://')) {
      return yield* new ToolError({ message: `webhooks need an https URL, got ${origin}` });
    }
    const psp = yield* Psp;
    const provider = yield* FulfillmentProvider;
    const failed = (url: string) => (e: { readonly message: string }) =>
      Effect.succeed({ status: 'failed' as const, url, message: e.message });
    const stripeUrl = `${origin}/webhooks/stripe`;
    const printfulUrl = `${origin}/webhooks/printful`;
    const stripe = yield* psp.registerWebhook(stripeUrl).pipe(Effect.catchAll(failed(stripeUrl)));
    const printful = yield* provider
      .registerWebhook(printfulUrl)
      .pipe(Effect.catchAll(failed(printfulUrl)));
    return { stripe, printful } satisfies WebhookRegisterResult;
  });

export const PrintfileCheckRequest = Schema.Struct({
  url: Schema.String.pipe(Schema.pattern(/^https?:\/\//)),
  offer: Schema.String,
  variant: Schema.String,
});

export const PrintfileCheckResult = Schema.Struct({
  spec: PrintfileSpec,
  specHash: Schema.String,
  file: PrintfileInspection,
  ok: Schema.Boolean,
  problems: Schema.Array(Schema.String),
});
export type PrintfileCheckResult = typeof PrintfileCheckResult.Type;

/** Check any URL against the Spec of an Offer variant, the way Pressline checks an Engine's Printfile. */
export const printfileCheck = (req: typeof PrintfileCheckRequest.Type) =>
  Effect.gen(function* () {
    const catalog = yield* resolveCatalog.pipe(
      Effect.mapError((e) => new ToolError({ message: e.message })),
    );
    const offer = catalog.offers.find((o) => o.slug === req.offer);
    const variant = offer?.variants.find((v) => v.key === req.variant);
    if (!offer || !variant) {
      return yield* new ToolError({
        message: `no Offer "${req.offer}" with variant "${req.variant}"`,
      });
    }
    const file = yield* inspectPrintfile(req.url).pipe(
      Effect.mapError((e) => new ToolError({ message: e.message })),
    );
    const spec = variant.spec;
    const problems: string[] = [];
    if (file.status !== 200 && file.status !== 206)
      problems.push(`${req.url} answered ${file.status}`);
    else if (!file.header) problems.push('not a readable PNG or JPEG header');
    else {
      if (!spec.formats.includes(file.header.format)) {
        problems.push(`${file.header.format} is not accepted here (${spec.formats.join(', ')})`);
      }
      if (file.header.width !== spec.width || file.header.height !== spec.height) {
        problems.push(
          `file is ${file.header.width}×${file.header.height}, spec requires ${spec.width}×${spec.height}`,
        );
      }
      if (spec.alpha === 'forbidden' && file.header.hasAlpha) {
        problems.push('file has an alpha channel, this placement forbids transparency');
      }
    }
    return {
      spec,
      specHash: variant.specHash,
      file,
      ok: problems.length === 0,
      problems,
    } satisfies PrintfileCheckResult;
  });
