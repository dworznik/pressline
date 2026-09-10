import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform';
import type { Effect } from 'effect';
import { EngineApi } from './engine-api.js';

export interface EngineClientOptions {
  /** The Engine's base URL as configured in Pressline. */
  readonly baseUrl: string | URL;
  /** Shared secret for this Engine (ADR-0001). Sent as a bearer token. */
  readonly secret: string;
}

/**
 * Typed client for one Engine. Needs an `HttpClient` in context
 * (`FetchHttpClient.layer` works on Node and Workers).
 */
export const makeEngineClient = (options: EngineClientOptions) =>
  HttpApiClient.make(EngineApi, {
    baseUrl: options.baseUrl,
    transformClient: (client) =>
      client.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(options.secret))),
  });

export type EngineClient = Effect.Effect.Success<ReturnType<typeof makeEngineClient>>;
