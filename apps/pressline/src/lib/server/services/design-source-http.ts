import type { HttpClient } from '@effect/platform';
import { makeEngineClient, type EngineClient } from '@pressline/contract';
import { Effect, Layer } from 'effect';
import {
  DesignNotFound,
  DesignSource,
  DesignSourceError,
  PrintfileRejected,
  UnknownEngine,
  type DesignSourceService,
} from './design-source';

export interface EngineEndpoint {
  readonly slug: string;
  readonly baseUrl: string;
  /** Shared secret for this Engine (ADR-0001); sent as a bearer token. */
  readonly secret: string;
}

/**
 * The shipped DesignSource: one @pressline/contract client per configured
 * Engine. Protocol errors (`DesignNotFound`, `PrintfileRejected`) pass
 * through; anything else (transport, decoding, an insecure base URL) is a
 * `DesignSourceError`. A decode failure is not retryable: the Engine is
 * speaking a different shape, and retrying will not change that.
 */
type ClientFailure = { readonly _tag: string; readonly message?: string };

/** A decode failure is not retryable: the Engine speaks a different shape, and retrying will not change that. */
const asTransportError = (engine: string, e: ClientFailure): DesignSourceError =>
  new DesignSourceError({
    engine,
    message: `engine ${engine}: ${e.message ?? e._tag}`,
    retryable: e._tag !== 'HttpApiDecodeError' && e._tag !== 'ParseError',
  });

/** Keep the protocol's own errors typed; fold everything else into `DesignSourceError`. */
const protocolOrTransport =
  (engine: string) =>
  <E extends ClientFailure>(e: E) =>
    e instanceof DesignNotFound || e instanceof PrintfileRejected ? e : asTransportError(engine, e);

export const makeDesignSourceHttp = (engines: ReadonlyArray<EngineEndpoint>) =>
  Effect.gen(function* () {
    const clients = new Map<string, EngineClient>();
    for (const e of engines) {
      const client = yield* makeEngineClient({ baseUrl: e.baseUrl, secret: e.secret }).pipe(
        Effect.mapError(
          (err) =>
            new DesignSourceError({
              engine: e.slug,
              message: `engine ${e.slug}: ${err.message}`,
              retryable: false,
            }),
        ),
      );
      clients.set(e.slug, client);
    }

    const client = (engine: string): Effect.Effect<EngineClient, UnknownEngine> => {
      const c = clients.get(engine);
      return c ? Effect.succeed(c) : Effect.fail(new UnknownEngine({ engine }));
    };

    const service: DesignSourceService = {
      health: (engine) =>
        Effect.gen(function* () {
          const c = yield* client(engine);
          return yield* c.health.health().pipe(Effect.mapError((e) => asTransportError(engine, e)));
        }),

      getDesign: (engine, designId) =>
        Effect.gen(function* () {
          const c = yield* client(engine);
          return yield* c.designs
            .getDesign({ path: { designId } })
            .pipe(Effect.mapError(protocolOrTransport(engine)));
        }),

      ensurePrintfile: (engine, designId, spec) =>
        Effect.gen(function* () {
          const c = yield* client(engine);
          return yield* c.designs
            .ensurePrintfile({ path: { designId }, payload: spec })
            .pipe(Effect.mapError(protocolOrTransport(engine)));
        }),
    };
    return service;
  });

export const layerDesignSourceHttp = (
  engines: ReadonlyArray<EngineEndpoint>,
): Layer.Layer<DesignSource, DesignSourceError, HttpClient.HttpClient> =>
  Layer.effect(DesignSource, makeDesignSourceHttp(engines));
