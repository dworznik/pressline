import { HttpApiBuilder, HttpServer } from '@effect/platform'
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
} from '@pressline/contract'
import { Effect, Layer } from 'effect'

/**
 * An in-process Engine built on the contract's own HttpApi, with the knobs
 * a conformance test needs to make it misbehave. The file it "hosts" is a
 * PNG header of the right (or wrong) size.
 */
export interface FakeEngineOptions {
  readonly design: DesignResponse
  /** Answer 202 this many times before 200. */
  readonly renderingTimes?: number
  /** Serve a file of this size instead of the Spec's. */
  readonly fileSize?: { width: number; height: number }
  /** Echo a wrong Spec Hash. */
  readonly wrongHash?: boolean
  /** A fresh URL on every call (not idempotent). */
  readonly freshUrls?: boolean
  /** Accept any Spec, even an impossible one. */
  readonly acceptsAnything?: boolean
  readonly protocolVersion?: string
  readonly previewStatus?: number
  /** Answer /designs/:id with a different Design ID. */
  readonly wrongId?: boolean
  /** Ignore Range and serve whole files with 200. */
  readonly ignoresRange?: boolean
  /**
   * Serve a PNG with nothing but its IHDR: no color space declared, no DPI
   * stamped. Legal, sellable, and two Deviations — which is what a report with
   * a `⚠` block is made of.
   */
  readonly bareHeader?: boolean
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A PNG chunk with no CRC: nothing that reads these files checks one. */
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  return out
}

const be32 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4)
  const v = new DataView(out.buffer)
  values.forEach((n, i) => v.setUint32(i * 4, n))
  return out
}

/** Everything the protocol asks for: 8-bit RGBA, sRGB declared, the Spec's DPI stamped. */
const pngHeader = (width: number, height: number, dpi: number, bare = false) => {
  const ihdr = new Uint8Array(13)
  ihdr.set(be32(width, height))
  ihdr[8] = 8
  ihdr[9] = 6
  const perMeter = Math.round(dpi / 0.0254)
  const phys = new Uint8Array(9)
  phys.set(be32(perMeter, perMeter))
  phys[8] = 1
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(bare ? [] : [chunk('sRGB', new Uint8Array([0])), chunk('pHYs', phys)]),
    chunk('IDAT', new Uint8Array(16)),
  ])
}

/** SOI, a JFIF APP0 stamping the Spec's DPI, then a three-component baseline frame header. */
const jpegHeader = (width: number, height: number, dpi: number) => {
  const app0 = new Uint8Array(18)
  const a = new DataView(app0.buffer)
  app0.set([0xff, 0xe0])
  a.setUint16(2, 16)
  app0.set(new TextEncoder().encode('JFIF'), 4)
  app0[9] = 1 // version 1.1
  app0[11] = 1 // density in dots per inch
  a.setUint16(12, dpi)
  a.setUint16(14, dpi)
  const sof = new Uint8Array(2 + 17)
  const s = new DataView(sof.buffer)
  sof.set([0xff, 0xc0])
  s.setUint16(2, 17)
  sof[4] = 8
  s.setUint16(5, height)
  s.setUint16(7, width)
  sof[9] = 3
  for (let i = 0; i < 3; i++) sof.set([i + 1, 0x11, i === 0 ? 0 : 1], 10 + i * 3)
  return concat([new Uint8Array([0xff, 0xd8]), app0, sof])
}

export const fakeEngine = (o: FakeEngineOptions) => {
  let renderingLeft = o.renderingTimes ?? 0
  let calls = 0
  const files = new Map<string, Uint8Array>()
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
            return yield* new DesignNotFound({ designId: path.designId })
          const spec: PrintfileSpec = payload
          const ratio = spec.width / spec.height
          const want = o.design.aspect.w / o.design.aspect.h
          if (!o.acceptsAnything && Math.abs(ratio - want) / want > 0.05) {
            return yield* new PrintfileRejected({
              code: 'aspect_mismatch',
              message: `this design is ${o.design.aspect.w}:${o.design.aspect.h}`,
            })
          }
          if (renderingLeft > 0) {
            renderingLeft -= 1
            const rendering: PrintfileRendering = { status: 'rendering', retryAfterMs: 300 }
            return rendering
          }
          const hash = yield* specHash(spec).pipe(Effect.orDie)
          calls += 1
          // The Engine renders the container the Spec asks for, as a real one would.
          const jpeg = spec.formats.includes('jpeg') && !spec.formats.includes('png')
          const url = `https://engine.test/files/${o.design.id}/${o.freshUrls ? calls : hash.slice(0, 8)}.${jpeg ? 'jpg' : 'png'}`
          const size = o.fileSize ?? { width: spec.width, height: spec.height }
          const bytes = jpeg
            ? jpegHeader(size.width, size.height, spec.dpi)
            : pngHeader(size.width, size.height, spec.dpi, o.bareHeader)
          files.set(url, bytes)
          const ready: PrintfileReady = {
            status: 'ready',
            url,
            sha256: 'a'.repeat(64),
            width: size.width,
            height: size.height,
            bytes: bytes.length,
            contentType: jpeg ? 'image/jpeg' : 'image/png',
            specHash: o.wrongHash ? 'b'.repeat(64) : hash,
          }
          return ready
        }),
      ),
  )
  const health = HttpApiBuilder.group(EngineApi, 'health', (handlers) =>
    handlers.handle('health', () =>
      Effect.succeed({ protocolVersion: o.protocolVersion ?? PROTOCOL_VERSION }),
    ),
  )
  const { handler } = HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.api(EngineApi).pipe(Layer.provide([designs, health])),
      HttpServer.layerContext,
    ),
  )
  /** Engine API plus the files and preview it hosts, as one fetch. */
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.hostname === 'engine.test' && url.pathname.startsWith('/files/')) {
      const file = files.get(req.url)
      if (!file) return new Response('not found', { status: 404 })
      const contentType = url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
      return o.ignoresRange
        ? new Response(new Blob([file as BlobPart]), {
            status: 200,
            headers: { 'content-type': contentType, 'content-length': String(file.length) },
          })
        : new Response(new Blob([file as BlobPart]), {
            status: 206,
            headers: {
              'content-type': contentType,
              'content-range': `bytes 0-${file.length - 1}/${file.length}`,
            },
          })
    }
    if (req.url === o.design.previewUrl) return new Response('', { status: o.previewStatus ?? 206 })
    return handler(req)
  }
  return { fetch }
}
