import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { createWasmBackend } from '../src/backends/wasm.js'
import { nodeBackend } from '../src/backends/node.js'
import type { Backend } from '../src/types.js'

const require = createRequire(import.meta.url)

/** The WASM backend fed from node_modules, the way a Worker would feed it from `.wasm` imports. */
export const wasmBackend = async (maxRawBytes?: number) =>
  createWasmBackend({
    modules: {
      png: await readFile(require.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')),
      jpeg: await readFile(require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
      resize: await readFile(
        require.resolve('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'),
      ),
      resvg: await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')),
    },
    ...(maxRawBytes !== undefined ? { maxRawBytes } : {}),
  })

export const backends: ReadonlyArray<[string, () => Promise<Backend>]> = [
  ['node', () => Promise.resolve(nodeBackend)],
  ['wasm', () => wasmBackend()],
]

/** PNG chunks by type, for header assertions (seam 3). */
export const chunks = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const out: { type: string; data: Uint8Array }[] = []
  let o = 8
  while (o + 8 <= png.length) {
    const len = view.getUint32(o)
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8))
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) })
    o += 12 + len
  }
  return out
}

export const header = (png: Uint8Array) => {
  const ihdr = chunks(png).find((c) => c.type === 'IHDR')!.data
  const v = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
  const phys = chunks(png).find((c) => c.type === 'pHYs')?.data
  const ppm = phys ? new DataView(phys.buffer, phys.byteOffset, phys.byteLength).getUint32(0) : 0
  return {
    width: v.getUint32(0),
    height: v.getUint32(4),
    bitDepth: ihdr[8]!,
    colorType: ihdr[9]!,
    dpi: Math.round(ppm * 0.0254),
    srgb: chunks(png).some((c) => c.type === 'sRGB'),
    hasTrns: chunks(png).some((c) => c.type === 'tRNS'),
  }
}

/** Pixel at (x, y) of a PNG, decoded by sharp (the reference decoder in tests). */
export const pixel = async (png: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(Buffer.from(png))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const
}

/** A 40×20 test image: left half opaque red, right half transparent. */
export const redLeft = () =>
  sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: { create: { width: 20, height: 20, channels: 4, background: '#ff0000' } },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b))

export const blueJpeg = () =>
  sharp({ create: { width: 30, height: 60, channels: 3, background: '#0000ff' } })
    .jpeg({ quality: 100 })
    .toBuffer()
    .then((b) => new Uint8Array(b))

export const greenSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#00ff00"/></svg>'
