import { Schema } from 'effect';
import { PrintfileSpec } from './spec.js';

/** Bumped only on a breaking change to the wire protocol; checked at Pressline startup and by `doctor`. */
export const PROTOCOL_VERSION = '1';

/**
 * Engine-scoped, unguessable Design ID (CONTEXT.md → Design). The schema can
 * only enforce shape (URL-safe, 8–128 chars); entropy is the Engine's
 * obligation.
 */
export const DesignId = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{8,128}$/));

/** Kebab-case identifier used for Offer slugs, Engine slugs and variant keys. */
export const Slug = Schema.String.pipe(Schema.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/));

/** Offer slug as configured by the Operator (CONTEXT.md → Offer). */
export const OfferSlug = Slug;

export const Aspect = Schema.Struct({
  w: Schema.Int.pipe(Schema.positive()),
  h: Schema.Int.pipe(Schema.positive()),
});
export type Aspect = typeof Aspect.Type;

/** `GET /designs/{designId}` → 200 */
export const DesignResponse = Schema.Struct({
  id: DesignId,
  title: Schema.optional(Schema.String),
  /** Whether the Engine currently permits ordering (CONTEXT.md → Sellable). */
  sellable: Schema.Boolean,
  /** Customer-facing image, any size; hot-linked, never stored. */
  previewUrl: Schema.String,
  aspect: Aspect,
  /** Eligibility by Offer slug; omitted = all (CONTEXT.md → Eligibility). */
  offers: Schema.optional(Schema.Array(OfferSlug)),
  /** Optional Engine-supplied Mockup per Offer slug. */
  mockups: Schema.optional(Schema.Record({ key: OfferSlug, value: Schema.String })),
  /** The Engine's own version marker; opaque to Pressline. */
  engineRef: Schema.optional(Schema.String),
});
export type DesignResponse = typeof DesignResponse.Type;

/** `GET /designs/{designId}` → 404 */
export class DesignNotFound extends Schema.TaggedError<DesignNotFound>()('DesignNotFound', {
  designId: Schema.String,
}) {}

/** `POST /designs/{designId}/printfile` → 200: the Printfile exists at an immutable URL (ADR-0003). */
export const PrintfileReady = Schema.Struct({
  status: Schema.Literal('ready'),
  url: Schema.String,
  sha256: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/)),
  width: Schema.Int.pipe(Schema.positive()),
  height: Schema.Int.pipe(Schema.positive()),
  bytes: Schema.Int.pipe(Schema.positive()),
  contentType: Schema.Literal('image/png', 'image/jpeg'),
  /** Echo of the Spec Hash the Engine rendered for; Pressline verifies it matches. */
  specHash: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/)),
});
export type PrintfileReady = typeof PrintfileReady.Type;

/** → 202: still rendering; poll the same call again (ADR-0005). */
export const PrintfileRendering = Schema.Struct({
  status: Schema.Literal('rendering'),
  retryAfterMs: Schema.Int.pipe(Schema.positive()),
});
export type PrintfileRendering = typeof PrintfileRendering.Type;

/** → 422: the Engine cannot satisfy this Spec for this Design (e.g. aspect mismatch). */
export class PrintfileRejected extends Schema.TaggedError<PrintfileRejected>()(
  'PrintfileRejected',
  {
    code: Schema.Literal('aspect_mismatch', 'unsupported_format', 'design_not_sellable', 'other'),
    message: Schema.String,
  },
) {}

/** `GET /health` → 200 */
export const EngineHealth = Schema.Struct({
  protocolVersion: Schema.String,
});
export type EngineHealth = typeof EngineHealth.Type;

/** Public catalogue served by Pressline (`GET /api/offers`) so Engines can pre-render. */
export const Money = Schema.Struct({
  /** Minor units (cents). */
  amount: Schema.Int.pipe(Schema.nonNegative()),
  /** ISO 4217. */
  currency: Schema.String.pipe(Schema.pattern(/^[A-Z]{3}$/)),
});
export type Money = typeof Money.Type;

/** Aspect range (w/h) an Offer accepts, inclusive. `null` = any. */
export const AspectRange = Schema.Struct({
  min: Schema.Number.pipe(Schema.positive()),
  max: Schema.Number.pipe(Schema.positive()),
});
export type AspectRange = typeof AspectRange.Type;

export const CatalogueVariant = Schema.Struct({
  /** Variant key as configured, e.g. `black-m`. */
  key: Schema.String,
  label: Schema.String,
  color: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  imageUrl: Schema.optional(Schema.String),
  spec: PrintfileSpec,
  specHash: Schema.String,
});
export type CatalogueVariant = typeof CatalogueVariant.Type;

export const CatalogueOffer = Schema.Struct({
  slug: OfferSlug,
  name: Schema.String,
  placement: Schema.String,
  technique: Schema.String,
  retailPrice: Money,
  aspect: Schema.NullOr(AspectRange),
  variants: Schema.Array(CatalogueVariant),
});
export type CatalogueOffer = typeof CatalogueOffer.Type;

export const CatalogueResponse = Schema.Struct({
  protocolVersion: Schema.String,
  currency: Schema.String,
  offers: Schema.Array(CatalogueOffer),
});
export type CatalogueResponse = typeof CatalogueResponse.Type;

export { PrintfileSpec };
