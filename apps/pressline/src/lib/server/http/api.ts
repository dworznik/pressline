import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform';
import {
  CatalogueOffer,
  CatalogueResponse,
  DesignNotFound,
  DesignResponse,
  Slug,
} from '@pressline/contract';
import { Schema } from 'effect';

/**
 * The Effect HttpApi: JSON API, operator API, Engine-facing endpoints and
 * webhooks (ADR-0012). Groups are added per ticket. SvelteKit forwards
 * `/api/*` and `/webhooks/*` here and renders everything else itself.
 */
export const HealthResponse = Schema.Struct({
  ok: Schema.Literal(true),
  protocolVersion: Schema.String,
  schemaVersion: Schema.Number,
  demo: Schema.Boolean,
  config: Schema.Struct({
    name: Schema.String,
    currency: Schema.String,
    offers: Schema.Number,
  }),
  engines: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      enabled: Schema.Boolean,
      protocolVersion: Schema.optional(Schema.String),
      reason: Schema.optional(Schema.String),
    }),
  ),
});
export type HealthResponse = typeof HealthResponse.Type;

export const HealthGroup = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('health', '/api/health').addSuccess(HealthResponse),
);

/** The Catalogue could not be resolved: misconfiguration or the provider is down. */
export class CatalogueUnavailable extends Schema.TaggedError<CatalogueUnavailable>()(
  'CatalogueUnavailable',
  { message: Schema.String, offer: Schema.optional(Schema.String) },
) {}

export const CatalogueGroup = HttpApiGroup.make('catalogue').add(
  HttpApiEndpoint.get('offers', '/api/offers')
    .addSuccess(CatalogueResponse)
    .addError(CatalogueUnavailable, { status: 503 }),
);

/** The configured Engine is disabled: protocol mismatch or unreachable at startup. */
export class EngineUnavailableError extends Schema.TaggedError<EngineUnavailableError>()(
  'EngineUnavailable',
  { engine: Schema.String, reason: Schema.String },
) {}

/** The Engine could not be reached for this request. */
export class EngineError extends Schema.TaggedError<EngineError>()('EngineError', {
  engine: Schema.String,
  message: Schema.String,
}) {}

/** What the Storefront needs to show a Design (ticket #5). */
export const DesignPage = Schema.Struct({
  engine: Schema.String,
  design: DesignResponse,
  /** Eligible Offers; empty when the Design is not sellable. */
  offers: Schema.Array(CatalogueOffer),
  currency: Schema.String,
});
export type DesignPage = typeof DesignPage.Type;

const DesignPath = Schema.Struct({ engine: Slug, designId: Schema.String });

export const DesignsGroup = HttpApiGroup.make('designs').add(
  HttpApiEndpoint.get('design', '/api/designs/:engine/:designId')
    .setPath(DesignPath)
    .addSuccess(DesignPage)
    .addError(DesignNotFound, { status: 404 })
    .addError(EngineUnavailableError, { status: 503 })
    .addError(EngineError, { status: 502 })
    .addError(CatalogueUnavailable, { status: 503 }),
);

export class PresslineApi extends HttpApi.make('pressline')
  .add(HealthGroup)
  .add(CatalogueGroup)
  .add(DesignsGroup) {}
