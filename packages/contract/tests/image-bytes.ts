import { deflateSync } from 'node:zlib'

/**
 * Byte-array builders for the header, refusal and Deviation tests (Wayfinder
 * map #107: known-bad and boundary files live here, not in the conformance
 * suite). The parser never checks CRCs, so the builders write none.
 *
 * The `iCCP` builders deflate a real ICC profile header, because the bounded
 * inflate under test is the only way a rule ever learns what a profile
 * declares. Deflating is not inflating: no ban touches it.
 */

export const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// ---- PNG --------------------------------------------------------------------

export const chunk = (
  type: string | Uint8Array,
  data: Uint8Array,
  declaredLength = data.length,
) => {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, declaredLength)
  out.set(typeof type === 'string' ? new TextEncoder().encode(type) : type, 4)
  out.set(data, 8)
  return out
}

export interface PngOptions {
  readonly colorType?: number
  readonly bitDepth?: number
  readonly interlace?: number
  readonly width?: number
  readonly height?: number
}

export const ihdr = ({
  colorType = 2,
  bitDepth = 8,
  interlace = 0,
  width = 1800,
  height = 2400,
}: PngOptions = {}) => {
  const data = new Uint8Array(13)
  const v = new DataView(data.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  data[8] = bitDepth
  data[9] = colorType
  data[12] = interlace
  return data
}

export const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Signature, IHDR, the given chunks, then a short IDAT. */
export const png = (options: PngOptions = {}, ...chunks: Uint8Array[]) =>
  concat([SIGNATURE, chunk('IHDR', ihdr(options)), ...chunks, chunk('IDAT', new Uint8Array(16))])

/** Signature, IHDR and the given chunks: no IDAT, so the chunk table never ends. */
export const pngWithoutIdat = (options: PngOptions = {}, ...chunks: Uint8Array[]) =>
  concat([SIGNATURE, chunk('IHDR', ihdr(options)), ...chunks])

/**
 * An iCCP chunk whose data is exactly `bytes` long: profile name, NUL,
 * compression method, then zeros where the deflated profile belongs. Nothing
 * inflates it, which is the `unseen` case.
 */
export const iccp = (bytes: number, name = 'ICC Profile') => {
  const head = concat([new TextEncoder().encode(name), new Uint8Array([0, 0])])
  const data = new Uint8Array(Math.max(bytes, head.length))
  data.set(head)
  return chunk('iCCP', data)
}

/**
 * An ICC profile header (ICC.1:2010 §7.2): its own size, the device class, the
 * data color space at byte 16, and the `acsp` signature at byte 36.
 */
export const iccProfile = (colorSpace: string, { acsp = true, size = 400 } = {}) => {
  const p = new Uint8Array(Math.max(size, 132))
  new DataView(p.buffer).setUint32(0, p.length)
  const write = (text: string, at: number) => p.set(new TextEncoder().encode(text), at)
  write('mntr', 12)
  write(colorSpace.padEnd(4).slice(0, 4), 16)
  write('XYZ ', 20)
  if (acsp) write('acsp', 36)
  return p
}

/** An iCCP chunk carrying a genuinely deflated profile, the only thing the bounded inflate can read. */
export const iccpWith = (
  colorSpace: string,
  {
    name = 'ICC Profile',
    acsp = true,
    prefixBytes,
  }: {
    name?: string
    acsp?: boolean
    /** Keep only this many bytes of the deflate stream, to cut it off mid-profile. */
    prefixBytes?: number
  } = {},
) => {
  const deflated = new Uint8Array(deflateSync(iccProfile(colorSpace, { acsp })))
  return chunk(
    'iCCP',
    concat([
      new TextEncoder().encode(name),
      new Uint8Array([0, 0]),
      prefixBytes === undefined ? deflated : deflated.subarray(0, prefixBytes),
    ]),
  )
}

/** A `tEXt` chunk of `bytes` of filler, to push what follows further into the file. */
export const text = (bytes: number) => chunk('tEXt', new Uint8Array(Math.max(bytes, 0)))

export const trns = chunk('tRNS', new Uint8Array([0, 0]))
export const srgb = chunk('sRGB', new Uint8Array([0]))
/** A `gAMA` chunk: the gamma scaled by 100 000. */
export const gamaWith = (value: number) => {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value)
  return chunk('gAMA', data)
}
/** The sRGB gamma, 1/2.2. */
export const gama = gamaWith(45_455)
export const plte = chunk('PLTE', new Uint8Array(3))

/** A pHYs chunk. `unit` is 1 for meters, 0 for "aspect ratio only" (PNG §11.3.5.3). */
export const phys = (x: number, y = x, unit = 1) => {
  const data = new Uint8Array(9)
  const v = new DataView(data.buffer)
  v.setUint32(0, x)
  v.setUint32(4, y)
  data[8] = unit
  return chunk('pHYs', data)
}

/** Pixels per meter for a dpi, the way `@pressline/render` stamps it. */
export const pixelsPerMeter = (dpi: number) => Math.round(dpi / 0.0254)

// ---- JPEG -------------------------------------------------------------------

export interface SofOptions {
  readonly precision?: number
  readonly components?: number
  readonly width?: number
  readonly height?: number
  /** SOF marker: 0xC0 baseline, 0xC2 progressive. */
  readonly marker?: number
}

export const sof = ({
  precision = 8,
  components = 3,
  width = 1800,
  height = 2400,
  marker = 0xc0,
}: SofOptions = {}) => {
  const data = new Uint8Array(6 + components * 3)
  const v = new DataView(data.buffer)
  v.setUint16(0, data.length + 2)
  data[2] = precision
  v.setUint16(3, height)
  v.setUint16(5, width)
  data[7] = components
  for (let i = 0; i < components; i++) {
    data[8 + i * 3] = i + 1
    data[9 + i * 3] = 0x11
    data[10 + i * 3] = i === 0 ? 0 : 1
  }
  return concat([new Uint8Array([0xff, marker]), data])
}

/** SOI, the given segments, then a SOF for the given frame. */
export const jpeg = (options: SofOptions = {}, ...segments: Uint8Array[]) =>
  concat([new Uint8Array([0xff, 0xd8]), ...segments, sof(options)])

/** A JFIF APP0 segment. `units` is 0 (aspect only), 1 (dots per inch) or 2 (per centimeter). */
export const app0 = (x: number, y = x, units = 1) => {
  const data = new Uint8Array(16)
  const v = new DataView(data.buffer)
  v.setUint16(0, 16)
  data.set(new TextEncoder().encode('JFIF'), 2)
  data[6] = 0
  data[7] = 1 // version 1.2
  data[8] = 2
  data[9] = units
  v.setUint16(10, x)
  v.setUint16(12, y)
  return concat([new Uint8Array([0xff, 0xe0]), data])
}

/**
 * An Adobe APP14 segment. `transform` is 0 (none/CMYK), 1 (YCbCr) or 2 (YCCK).
 * `padding` appends bytes past the documented 14, the way some encoders do.
 */
export const app14 = (transform: number, padding = 0) => {
  const data = new Uint8Array(14 + padding)
  const v = new DataView(data.buffer)
  v.setUint16(0, data.length)
  data.set(new TextEncoder().encode('Adobe'), 2)
  v.setUint16(7, 100) // version
  data[13] = transform
  return concat([new Uint8Array([0xff, 0xee]), data])
}

/**
 * An `APP2` segment carrying an embedded ICC profile, the way an exporter
 * writes one. Nothing reads it: the frame header already proves the channels.
 */
export const app2 = (colorSpace: string) => {
  const profile = iccProfile(colorSpace)
  const data = new Uint8Array(2 + 12 + 2 + profile.length)
  new DataView(data.buffer).setUint16(0, data.length)
  data.set(new TextEncoder().encode('ICC_PROFILE\0'), 2)
  data[14] = 1 // chunk 1
  data[15] = 1 // of 1
  data.set(profile, 16)
  return concat([new Uint8Array([0xff, 0xe2]), data])
}

/**
 * Comment segments carrying at least `bytes` of filler, used to push the frame
 * header past a window. A JPEG segment cannot exceed 65 533 bytes, so a large
 * filler is several of them.
 */
export const filler = (bytes: number) => {
  const segments: Uint8Array[] = []
  for (let left = bytes; left > 0; left -= 65_000) {
    const data = new Uint8Array(2 + Math.min(left, 65_000))
    new DataView(data.buffer).setUint16(0, data.length)
    segments.push(concat([new Uint8Array([0xff, 0xfe]), data]))
  }
  return concat(segments)
}
