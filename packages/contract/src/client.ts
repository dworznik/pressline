import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { EngineApi } from './engine-api.js';

/** The Engine base URL would send the shared secret in the clear. */
export class InsecureEngineBaseUrl extends Schema.TaggedError<InsecureEngineBaseUrl>()(
  'InsecureEngineBaseUrl',
  { baseUrl: Schema.String },
) {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The bearer secret must never travel in the clear: `https:` only, with
 * plain `http:` tolerated for loopback hosts during local development.
 */
export const isSecureEngineBaseUrl = (baseUrl: string | URL): boolean => {
  try {
    const url = new URL(String(baseUrl));
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
};

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
  Effect.gen(function* () {
    if (!isSecureEngineBaseUrl(options.baseUrl)) {
      return yield* new InsecureEngineBaseUrl({ baseUrl: String(options.baseUrl) });
    }
    return yield* HttpApiClient.make(EngineApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        client.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(options.secret))),
    });
  });

export type EngineClient = Effect.Effect.Success<ReturnType<typeof makeEngineClient>>;
