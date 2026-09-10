import { FetchHttpClient, HttpApiBuilder, HttpServer, HttpServerRequest } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  DesignNotFound,
  EngineApi,
  makeEngineClient,
  PrintfileRejected,
  PROTOCOL_VERSION,
  specHash,
  type PrintfileSpec,
} from '../src/index';

/**
 * A fake Engine built from the same HttpApi, served in-process. The client
 * talks to it through an injected `fetch`, so nothing touches the network.
 */
const spec: PrintfileSpec = {
  width: 1800,
  height: 2400,
  dpi: 150,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'required',
  placement: 'front',
  technique: 'dtg',
};

const seen: { auth: string[] } = { auth: [] };
let renderCalls = 0;

const DesignsLive = HttpApiBuilder.group(EngineApi, 'designs', (handlers) =>
  handlers
    .handle('getDesign', ({ path }) =>
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        seen.auth.push(req.headers['authorization'] ?? '');
        if (path.designId === 'missing-000')
          return yield* new DesignNotFound({ designId: path.designId });
        return {
          id: path.designId,
          sellable: true,
          previewUrl: 'https://engine.test/p/1.png',
          aspect: { w: 3, h: 4 },
          offers: ['tee-black-front'],
        };
      }),
    )
    .handle('ensurePrintfile', ({ path, payload }) =>
      Effect.gen(function* () {
        if (path.designId === 'square-00001')
          return yield* new PrintfileRejected({ code: 'aspect_mismatch', message: 'square only' });
        renderCalls += 1;
        if (renderCalls === 1) return { status: 'rendering' as const, retryAfterMs: 500 };
        const hash = yield* Effect.promise(() => specHash(payload));
        return {
          status: 'ready' as const,
          url: `https://engine.test/f/${path.designId}/${hash}.png`,
          sha256: 'a'.repeat(64),
          width: payload.width,
          height: payload.height,
          bytes: 1234,
          contentType: 'image/png' as const,
          specHash: hash,
        };
      }),
    ),
);

const HealthLive = HttpApiBuilder.group(EngineApi, 'health', (handlers) =>
  handlers.handle('health', () => Effect.succeed({ protocolVersion: PROTOCOL_VERSION })),
);

const { handler } = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(
    HttpApiBuilder.api(EngineApi).pipe(Layer.provide([DesignsLive, HealthLive])),
    HttpServer.layerContext,
  ),
);

const ClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.Fetch, ((input, init) =>
      handler(new Request(input, init))) as typeof fetch),
  ),
);

const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runPromise(eff);
const withClient = <A, E>(
  f: (c: Effect.Effect.Success<ReturnType<typeof makeEngineClient>>) => Effect.Effect<A, E>,
) =>
  run(
    Effect.gen(function* () {
      const client = yield* makeEngineClient({ baseUrl: 'http://engine.test', secret: 's3cret' });
      return yield* f(client);
    }).pipe(Effect.provide(ClientLayer)),
  );

describe('Engine client over the DesignSource protocol', () => {
  it('fetches a design and sends the shared secret as a bearer token', async () => {
    const design = await withClient((c) =>
      c.designs.getDesign({ path: { designId: 'design-00001' } }),
    );
    expect(design).toMatchObject({ id: 'design-00001', sellable: true, aspect: { w: 3, h: 4 } });
    expect(seen.auth.at(-1)).toBe('Bearer s3cret');
  });

  it('surfaces 404 as a typed DesignNotFound', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const c = yield* makeEngineClient({ baseUrl: 'http://engine.test', secret: 's' });
        return yield* c.designs.getDesign({ path: { designId: 'missing-000' } });
      }).pipe(Effect.provide(ClientLayer), Effect.flip),
    );
    expect(exit).toBeInstanceOf(DesignNotFound);
  });

  it('ensurePrintfile returns rendering (202) then ready (200) with the Spec Hash echoed', async () => {
    const first = await withClient((c) =>
      c.designs.ensurePrintfile({ path: { designId: 'design-00001' }, payload: spec }),
    );
    expect(first).toEqual({ status: 'rendering', retryAfterMs: 500 });
    const second = await withClient((c) =>
      c.designs.ensurePrintfile({ path: { designId: 'design-00001' }, payload: spec }),
    );
    expect(second).toMatchObject({
      status: 'ready',
      width: 1800,
      height: 2400,
      contentType: 'image/png',
    });
    expect((second as { specHash: string }).specHash).toBe(await specHash(spec));
  });

  it('surfaces 422 as a typed PrintfileRejected', async () => {
    const err = await run(
      Effect.gen(function* () {
        const c = yield* makeEngineClient({ baseUrl: 'http://engine.test', secret: 's' });
        return yield* c.designs.ensurePrintfile({
          path: { designId: 'square-00001' },
          payload: spec,
        });
      }).pipe(Effect.provide(ClientLayer), Effect.flip),
    );
    expect(err).toBeInstanceOf(PrintfileRejected);
    expect((err as PrintfileRejected).code).toBe('aspect_mismatch');
  });

  it('reports the protocol version from /health', async () => {
    expect(await withClient((c) => c.health.health())).toEqual({ protocolVersion: '1' });
  });
});
