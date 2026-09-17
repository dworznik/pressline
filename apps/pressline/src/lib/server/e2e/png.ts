/**
 * Hand-built PNG headers: structurally valid signature + IHDR + padding, no
 * pixel data. The bridge validates by header only (ADR-0002), so this is all
 * a test or the e2e seed needs to stand in for an Engine's Printfile.
 */
const crc32 = (bytes: Uint8Array) => {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export interface PngOptions {
  width: number
  height: number
  /** 0 gray, 2 rgb, 3 palette, 4 gray+alpha, 6 rgba */
  colorType?: 0 | 2 | 3 | 4 | 6
  /** Bits per channel. Anything but 8 is a rejection (#87). */
  bitDepth?: number
  /** Adam7 interlacing, also a rejection. */
  interlace?: 0 | 1
  /** Add a tRNS chunk (transparency without an alpha channel). */
  trns?: boolean
  /** Pad with junk so the file has this total size. */
  totalBytes?: number
  /** An iCCP chunk of this many bytes ahead of tRNS and IDAT, to push them past the header window. */
  iccpBytes?: number
  /** Declare sRGB and stamp a DPI, so the file carries no Deviation. */
  srgbAt?: number
}

export const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A structurally valid PNG prefix: signature, IHDR, optional iCCP and tRNS, then padding "IDAT". */
export const png = ({
  width,
  height,
  colorType = 6,
  bitDepth = 8,
  interlace = 0,
  trns = false,
  totalBytes,
  iccpBytes,
  srgbAt,
}: PngOptions) => {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  ihdr[12] = interlace
  const phys = new Uint8Array(9)
  if (srgbAt !== undefined) {
    const perMeter = Math.round(srgbAt / 0.0254)
    new DataView(phys.buffer).setUint32(0, perMeter)
    new DataView(phys.buffer).setUint32(4, perMeter)
    phys[8] = 1
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(srgbAt === undefined ? [] : [chunk('sRGB', new Uint8Array([0])), chunk('pHYs', phys)]),
    ...(iccpBytes ? [chunk('iCCP', new Uint8Array(iccpBytes))] : []),
    ...(trns ? [chunk('tRNS', new Uint8Array([0, 0]))] : []),
  ]
  const head = concat(parts)
  const size = Math.max(totalBytes ?? head.length + 12, head.length + 12)
  const idat = chunk('IDAT', new Uint8Array(size - head.length - 12))
  return concat([head, idat])
}
