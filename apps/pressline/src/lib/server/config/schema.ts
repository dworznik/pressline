import { AspectRange, OfferSlug, Slug } from '@pressline/contract';
import { Context, Effect, Layer, ParseResult, Schema } from 'effect';

/**
 * Operator configuration (ADR-0014): a typed file in the deployed repo,
 * validated at boot. Secrets are NOT here; they come from the platform env.
 */
export const EngineConfig = Schema.Struct({
  slug: Slug,
  baseUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//)),
});
export type EngineConfig = typeof EngineConfig.Type;

/** One sellable variant of an Offer: a Printful catalog variant (ADR-0006). */
export const OfferVariantConfig = Schema.Struct({
  /** Printful catalog `variant_id`. */
  catalogVariantId: Schema.Int.pipe(Schema.positive()),
  label: Schema.NonEmptyString,
  color: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  /** Product photo for this variant, used by the Storefront overlay Mockup. */
  imageUrl: Schema.optional(Schema.String),
});
export type OfferVariantConfig = typeof OfferVariantConfig.Type;

/** Offer (CONTEXT.md): one sellable thing, one Placement, one price. */
export const OfferConfig = Schema.Struct({
  slug: OfferSlug,
  name: Schema.NonEmptyString,
  /** Printful catalog product id; all variants must belong to it. */
  catalogProductId: Schema.Int.pipe(Schema.positive()),
  /** Provider placement key, e.g. `front`. */
  placement: Schema.NonEmptyString,
  /** Provider technique key, e.g. `dtg`. */
  technique: Schema.NonEmptyString,
  /** Retail price in minor units of the instance currency. */
  retailPrice: Schema.Int.pipe(Schema.positive()),
  /** Aspect (w/h) range this Offer accepts; omitted = any. */
  aspect: Schema.optional(AspectRange),
  /** Variant key → catalog variant. Keys are stable, e.g. `black-m`. */
  variants: Schema.Record({ key: Slug, value: OfferVariantConfig }).pipe(
    Schema.filter((v) => Object.keys(v).length > 0 || 'an Offer needs at least one variant'),
  ),
}).pipe(
  Schema.filter((o) =>
    o.aspect === undefined || o.aspect.min <= o.aspect.max
      ? true
      : `Offer "${o.slug}": aspect.min must be <= aspect.max`,
  ),
);
export type OfferConfig = typeof OfferConfig.Type;

export const CatalogueConfig = Schema.Struct({
  offers: Schema.Array(OfferConfig).pipe(
    Schema.filter((offers) => {
      const seen = new Set<string>();
      for (const o of offers) {
        if (seen.has(o.slug)) return `duplicate Offer slug "${o.slug}"`;
        seen.add(o.slug);
      }
      return true;
    }),
  ),
});
export type CatalogueConfig = typeof CatalogueConfig.Type;

export const PresslineConfigSchema = Schema.Struct({
  /** Shown on the Storefront and in emails. */
  name: Schema.NonEmptyString,
  /** ISO 4217, one per instance (ADR-0015). */
  currency: Schema.String.pipe(Schema.pattern(/^[A-Z]{3}$/)),
  /** Trusted Engines wired to this instance (ADR-0001). */
  engines: Schema.Array(EngineConfig).pipe(Schema.minItems(1)),
  /** The Catalogue (CONTEXT.md). Empty is allowed while setting up. */
  catalogue: Schema.optionalWith(CatalogueConfig, { default: () => ({ offers: [] }) }),
  /** Demo Mode: no money and no goods move. */
  demo: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  printfile: Schema.optionalWith(
    Schema.Struct({
      /** How long one ensure-Printfile request may wait on a rendering Engine before answering 202 (ADR-0005). */
      waitMs: Schema.optionalWith(Schema.Int.pipe(Schema.between(0, 25_000)), {
        default: () => 8_000,
      }),
    }),
    { default: () => ({ waitMs: 8_000 }) },
  ),
});
export type PresslineConfig = typeof PresslineConfigSchema.Type;

export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}

/**
 * Decode a raw config object; fails boot with a readable message. Errors
 * inside the Catalogue name the offending Offer by slug when one can be read
 * from the raw input, so the Operator does not have to count array indexes.
 */
export const decodeConfig = (raw: unknown): Effect.Effect<PresslineConfig, ConfigError> =>
  Schema.decodeUnknown(PresslineConfigSchema, { errors: 'all' })(raw).pipe(
    Effect.mapError((e) => new ConfigError({ message: formatConfigError(raw, e) })),
  );

const formatConfigError = (raw: unknown, e: ParseResult.ParseError): string => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(e);
  const lines = issues.map((issue) => {
    const path = issue.path.map(String);
    const where = path.join('.');
    const offer = offerSlugAt(raw, path);
    return offer ? `Offer "${offer}" (${where}): ${issue.message}` : `${where}: ${issue.message}`;
  });
  return `pressline.config.ts is invalid:\n${lines.map((l) => `  - ${l}`).join('\n')}`;
};

const offerSlugAt = (raw: unknown, path: ReadonlyArray<string>): string | undefined => {
  if (path[0] !== 'catalogue' || path[1] !== 'offers' || path[2] === undefined) return undefined;
  const offers = (raw as { catalogue?: { offers?: unknown[] } })?.catalogue?.offers;
  const offer = offers?.[Number(path[2])] as { slug?: unknown } | undefined;
  return typeof offer?.slug === 'string' ? offer.slug : undefined;
};

export class Config extends Context.Tag('pressline/Config')<Config, PresslineConfig>() {
  static readonly layer = (raw: unknown) => Layer.effect(Config, decodeConfig(raw));
}

/** Helper for config authors: `export default defineConfig({...})`. */
export const defineConfig = (config: typeof PresslineConfigSchema.Encoded) => config;
