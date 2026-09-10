import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform';
import { CatalogueResponse } from '@pressline/contract';
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
    engines: Schema.Array(Schema.String),
    offers: Schema.Number,
  }),
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

export class PresslineApi extends HttpApi.make('pressline').add(HealthGroup).add(CatalogueGroup) {}
