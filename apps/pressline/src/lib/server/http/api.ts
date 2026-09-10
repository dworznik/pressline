import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform';
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
  }),
});
export type HealthResponse = typeof HealthResponse.Type;

export const HealthGroup = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('health', '/api/health').addSuccess(HealthResponse),
);

export class PresslineApi extends HttpApi.make('pressline').add(HealthGroup) {}

/** DesignSource protocol version this bridge speaks; canonical home is @pressline/contract (#3). */
export const PROTOCOL_VERSION = '1';
