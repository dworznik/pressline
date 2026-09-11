import {
  HttpApiBuilder,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  DesignNotFound,
  EngineApi,
  PrintfileRejected,
  PROTOCOL_VERSION,
  type DesignResponse,
  type PrintfileReady,
} from '@pressline/contract';
import { Effect, Layer } from 'effect';
import { ensurePrintfile, loadDesign, type Design, type Engine } from './designs.js';

/** Constant time over the longer input, so neither the match nor the length shows in timing. */
const timingSafeEqual = (a: string, b: string) => {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};

/** Every request from Pressline carries `Authorization: Bearer <shared secret>` (ADR-0001). Anything else is 401. */
const bearerAuth = (secret: string) =>
  HttpApiBuilder.middleware((httpApp) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest;
      const given = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] ?? '')?.[1] ?? '';
      if (!secret || !timingSafeEqual(given, secret)) {
        return HttpServerResponse.unsafeJson(
          { _tag: 'Unauthorized', message: 'missing or wrong engine secret' },
          { status: 401 },
        );
      }
      return yield* httpApp;
    }),
  );

const toResponse = (d: Design): DesignResponse => ({
  id: d.id,
  title: d.title,
  sellable: true,
  previewUrl: d.previewUrl,
  aspect: d.aspect,
  ...(d.offers ? { offers: d.offers } : {}),
});

/** The DesignSource protocol served from the contract's own HttpApi. */
export const makeEngineHandler = (engine: Engine, secret: string) => {
  const designs = HttpApiBuilder.group(EngineApi, 'designs', (handlers) =>
    handlers
      .handle('getDesign', ({ path }) =>
        Effect.gen(function* () {
          const d = yield* Effect.promise(() => loadDesign(engine.store, path.designId));
          if (!d) return yield* new DesignNotFound({ designId: path.designId });
          return toResponse(d);
        }),
      )
      .handle('ensurePrintfile', ({ path, payload }) =>
        Effect.gen(function* () {
          const d = yield* Effect.promise(() => loadDesign(engine.store, path.designId));
          if (!d) return yield* new DesignNotFound({ designId: path.designId });
          const result = yield* Effect.promise(() => ensurePrintfile(engine, d, payload));
          if ('rejected' in result) {
            return yield* new PrintfileRejected({ code: result.rejected, message: result.message });
          }
          const ready: PrintfileReady = result.ready;
          return ready;
        }),
      ),
  );
  const health = HttpApiBuilder.group(EngineApi, 'health', (handlers) =>
    handlers.handle('health', () => Effect.succeed({ protocolVersion: PROTOCOL_VERSION })),
  );
  return HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.api(EngineApi).pipe(Layer.provide([designs, health])),
      bearerAuth(secret),
      HttpServer.layerContext,
    ),
  ).handler;
};
