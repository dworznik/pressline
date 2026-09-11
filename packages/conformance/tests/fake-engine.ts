import { HttpApiBuilder, HttpServer } from '@effect/platform';
import {
  DesignNotFound,
  EngineApi,
  PrintfileRejected,
  PROTOCOL_VERSION,
  specHash,
  type DesignResponse,
  type PrintfileReady,
  type PrintfileRendering,
  type PrintfileSpec,
} from '@pressline/contract';
import { Effect, Layer } from 'effect';

/**
 * An in-process Engine built on the contract's own HttpApi, with the knobs
 * a conformance test needs to make it misbehave. The file it "hosts" is a
 * PNG header of the right (or wrong) size.
 */
export interface FakeEngineOptions {
  readonly design: DesignResponse;
  /** Answer 202 this many times before 200. */
  readonly renderingTimes?: number;
  /** Serve a file of this size instead of the Spec's. */
  readonly fileSize?: { width: number; height: number };
  /** Echo a wrong Spec Hash. */
  readonly wrongHash?: boolean;
  /** A fresh URL on every call (not idempotent). */
  readonly freshUrls?: boolean;
  /** Accept any Spec, even an impossible one. */
  readonly acceptsAnything?: boolean;
  readonly protocolVersion?: string;
  readonly previewStatus?: number;
  /** Answer /designs/:id with a different Design ID. */
  readonly wrongId?: boolean;
  /** Ignore Range and serve whole files with 200. */
  readonly ignoresRange?: boolean;
}

const pngHeader = (width: number, height: number) => {
  const out = new Uint8Array(64);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(out.buffer);
  v.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  v.setUint32(16, width);
  v.setUint32(20, height);
  out[24] = 8;
  out[25] = 6;
  v.setUint32(33, 0);
  out.set([0x49, 0x44, 0x41, 0x54], 37);
  return out;
};

export const fakeEngine = (o: FakeEngineOptions) => {
  let renderingLeft = o.renderingTimes ?? 0;
  let calls = 0;
  const files = new Map<string, Uint8Array>();
  const designs = HttpApiBuilder.group(EngineApi, 'designs', (handlers) =>
    handlers
      .handle('getDesign', ({ path }) =>
        path.designId === o.design.id
          ? Effect.succeed(o.wrongId ? { ...o.design, id: 'other-design-0001' } : o.design)
          : Effect.fail(new DesignNotFound({ designId: path.designId })),
      )
      .handle('ensurePrintfile', ({ path, payload }) =>
        Effect.gen(function* () {
          if (path.designId !== o.design.id)
            return yield* new DesignNotFound({ designId: path.designId });
          const spec: PrintfileSpec = payload;
          const ratio = spec.width / spec.height;
          const want = o.design.aspect.w / o.design.aspect.h;
          if (!o.acceptsAnything && Math.abs(ratio - want) / want > 0.05) {
            return yield* new PrintfileRejected({
              code: 'aspect_mismatch',
              message: `this design is ${o.design.aspect.w}:${o.design.aspect.h}`,
            });
          }
          if (renderingLeft > 0) {
            renderingLeft -= 1;
            const rendering: PrintfileRendering = { status: 'rendering', retryAfterMs: 300 };
            return rendering;
          }
          const hash = yield* specHash(spec).pipe(Effect.orDie);
          calls += 1;
          const url = `https://engine.test/files/${o.design.id}/${o.freshUrls ? calls : hash.slice(0, 8)}.png`;
          const size = o.fileSize ?? { width: spec.width, height: spec.height };
          files.set(url, pngHeader(size.width, size.height));
          const ready: PrintfileReady = {
            status: 'ready',
            url,
            sha256: 'a'.repeat(64),
            width: size.width,
            height: size.height,
            bytes: 64,
            contentType: 'image/png',
            specHash: o.wrongHash ? 'b'.repeat(64) : hash,
          };
          return ready;
        }),
      ),
  );
  const health = HttpApiBuilder.group(EngineApi, 'health', (handlers) =>
    handlers.handle('health', () =>
      Effect.succeed({ protocolVersion: o.protocolVersion ?? PROTOCOL_VERSION }),
    ),
  );
  const { handler } = HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.api(EngineApi).pipe(Layer.provide([designs, health])),
      HttpServer.layerContext,
    ),
  );
  /** Engine API plus the files and preview it hosts, as one fetch. */
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === 'engine.test' && url.pathname.startsWith('/files/')) {
      const file = files.get(req.url);
      if (!file) return new Response('not found', { status: 404 });
      return o.ignoresRange
        ? new Response(new Blob([file as BlobPart]), {
            status: 200,
            headers: { 'content-type': 'image/png', 'content-length': String(file.length) },
          })
        : new Response(new Blob([file as BlobPart]), {
            status: 206,
            headers: {
              'content-type': 'image/png',
              'content-range': `bytes 0-${file.length - 1}/${file.length}`,
            },
          });
    }
    if (req.url === o.design.previewUrl)
      return new Response('', { status: o.previewStatus ?? 206 });
    return handler(req);
  };
  return { fetch };
};
