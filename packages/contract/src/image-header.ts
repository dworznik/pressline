/**
 * The header read: everything Pressline knows about a Printfile without
 * decoding a single pixel (ADR-0002). One parser, shared by Validation, the
 * conformance suite, `printfile check` and an Engine developer's Preflight, so
 * none of them can disagree about what a file says.
 *
 * The window is `HEADER_BYTES` when the bytes come off the wire; a local file
 * read whole gives the same parser more to see, which is exactly how Preflight
 * spots a file whose chunk table would outrun Pressline's read.
 */

export const HEADER_BYTES = 64 * 1024

/**
 * What the header read says about transparency. `unseen` means the chunk
 * table ran past the window before IDAT, so the read proved nothing either
 * way (#117); callers must not treat it as `absent`.
 */
export type AlphaObservation = 'present' | 'absent' | 'unseen'

/**
 * The physical resolution a file stamps on itself: PNG's `pHYs`, JPEG's JFIF
 * `APP0`. `x` and `y` are in the file's own unit; `dpiX`/`dpiY` are those
 * values in dots per inch, rounded, and are absent when the unit is not a
 * physical one.
 */
export interface Density {
  readonly x: number
  readonly y: number
  readonly unit: 'meter' | 'inch' | 'centimeter' | 'aspect'
  readonly dpiX?: number
  readonly dpiY?: number
}

export interface ImageHeaderFields {
  readonly width: number
  readonly height: number
  readonly alpha: AlphaObservation
  /**
   * Byte offset, from the start of the file, where the pixel data begins: the
   * first `IDAT` in a PNG, the frame header (`SOF`) in a JPEG. Everything the
   * header read can ever see lies before it. Absent when the bytes handed to
   * the parser ended first.
   */
  readonly pixelDataOffset?: number
  readonly density?: Density
}

export interface PngImageHeader extends ImageHeaderFields {
  readonly format: 'png'
  /** Bits per channel, `IHDR` byte 24. */
  readonly bitDepth: number
  /** `IHDR` byte 25: 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA. */
  readonly colorType: number
  /** `IHDR` byte 28: Adam7 interlacing. */
  readonly interlaced: boolean
  /** Chunk types seen between `IHDR` and the first `IDAT`, in file order. */
  readonly chunks: readonly string[]
  /**
   * The `iCCP` chunk's profile name and the size of the profile it carries,
   * still deflated. Whether the profile can be identified is #116's question;
   * the header only reports that one is there.
   */
  readonly iccProfile?: { readonly name: string; readonly compressedBytes: number }
}

export interface JpegImageHeader extends ImageHeaderFields {
  readonly format: 'jpeg'
  /** Bits per sample, from the frame header. */
  readonly precision: number
  /** Channels in the frame: 1 grayscale, 3 YCbCr, 4 CMYK or YCCK. */
  readonly components: number
  /** The Adobe `APP14` color transform, when that segment is present: 0 none (RGB or CMYK), 1 YCbCr, 2 YCCK. */
  readonly adobeTransform?: number
}

export type ImageHeader = PngImageHeader | JpegImageHeader

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** A chunk's length never exceeds 2^31 - 1 (PNG §5.3). */
const MAX_CHUNK_LENGTH = 0x7fffffff
/** A chunk type is four ASCII letters (PNG §5.4). */
const isChunkType = (bytes: Uint8Array, at: number) =>
  bytes.subarray(at, at + 4).every((b) => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a))

const METERS_PER_INCH = 0.0254
const CENTIMETERS_PER_INCH = 2.54

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to))

// ---- PNG --------------------------------------------------------------------

interface ChunkTable {
  readonly alpha: AlphaObservation
  readonly chunks: readonly string[]
  readonly idatOffset?: number
  readonly density?: Density
  readonly iccProfile?: { readonly name: string; readonly compressedBytes: number }
}

/** `pHYs`: pixels per unit on each axis, then the unit (1 meter, 0 unspecified). PNG §11.3.5.3. */
const readPhys = (view: DataView, at: number, length: number): Density | undefined => {
  if (length < 9 || at + 8 + 9 > view.byteLength) return undefined
  const x = view.getUint32(at + 8)
  const y = view.getUint32(at + 12)
  if (view.getUint8(at + 16) !== 1) return { x, y, unit: 'aspect' }
  return {
    x,
    y,
    unit: 'meter',
    dpiX: Math.round(x * METERS_PER_INCH),
    dpiY: Math.round(y * METERS_PER_INCH),
  }
}

/** `iCCP`: a profile name (1–79 bytes), a NUL, the compression method, then the deflated profile. PNG §11.3.3.3. */
const readIccp = (bytes: Uint8Array, at: number, length: number) => {
  const start = at + 8
  const end = Math.min(start + Math.min(length, 80), bytes.length)
  const nul = bytes.subarray(start, end).indexOf(0)
  if (nul <= 0) return undefined
  return {
    name: ascii(bytes, start, start + nul),
    compressedBytes: Math.max(length - nul - 2, 0),
  }
}

/**
 * Walk the chunk table until the pixel data. The PNG ordering rules put every
 * chunk we care about — `tRNS`, `pHYs`, `sRGB`, `iCCP` — before the first
 * `IDAT`, so one pass over the table is the whole header. A chunk's 8-byte
 * header is enough to name it, so one that straddles the window still counts.
 * A malformed table means the file is unreadable, not that the field is absent.
 */
const walkChunks = (bytes: Uint8Array, view: DataView): ChunkTable | undefined => {
  const chunks: string[] = []
  let alpha: AlphaObservation = 'unseen'
  let density: Density | undefined
  let iccProfile: ChunkTable['iccProfile']
  let offset = 8 + 12 + 13 // the signature and IHDR, both already parsed
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    if (length > MAX_CHUNK_LENGTH || !isChunkType(bytes, offset + 4)) return undefined
    const type = ascii(bytes, offset + 4, offset + 8)
    if (type === 'IDAT' || type === 'IEND') {
      return {
        alpha: alpha === 'unseen' ? 'absent' : alpha,
        chunks,
        // Only IDAT marks where the pixel data starts; an IEND with no IDAT at all
        // proves the table ended, not where the image begins.
        ...(type === 'IDAT' ? { idatOffset: offset } : {}),
        ...(density ? { density } : {}),
        ...(iccProfile ? { iccProfile } : {}),
      }
    }
    chunks.push(type)
    if (type === 'tRNS') alpha = 'present'
    if (type === 'pHYs') density = readPhys(view, offset, length) ?? density
    if (type === 'iCCP') iccProfile = readIccp(bytes, offset, length) ?? iccProfile
    offset += 12 + length
  }
  return {
    alpha,
    chunks,
    ...(density ? { density } : {}),
    ...(iccProfile ? { iccProfile } : {}),
  }
}

const parsePng = (bytes: Uint8Array, view: DataView): PngImageHeader | undefined => {
  // IHDR is always first and always 13 bytes: length(4) 'IHDR'(4) width(4) height(4) depth(1) color type(1)
  if (view.getUint32(8) !== 13 || ascii(bytes, 12, 16) !== 'IHDR') return undefined
  const colorType = bytes[25]!
  const table = walkChunks(bytes, view)
  if (!table) return undefined
  return {
    format: 'png',
    width: view.getUint32(16),
    height: view.getUint32(20),
    alpha: colorType === 4 || colorType === 6 ? 'present' : table.alpha,
    bitDepth: bytes[24]!,
    colorType,
    interlaced: bytes[28] !== 0,
    chunks: table.chunks,
    ...(table.idatOffset === undefined ? {} : { pixelDataOffset: table.idatOffset }),
    ...(table.density ? { density: table.density } : {}),
    ...(table.iccProfile ? { iccProfile: table.iccProfile } : {}),
  }
}

// ---- JPEG -------------------------------------------------------------------

/** JFIF `APP0`: 'JFIF\0', version, a density unit (1 inch, 2 centimeter, 0 aspect), then both densities. */
const readApp0 = (bytes: Uint8Array, view: DataView, at: number, length: number) => {
  if (length < 14 || at + 16 > bytes.length || ascii(bytes, at + 4, at + 8) !== 'JFIF') return
  const unit = bytes[at + 11]!
  const x = view.getUint16(at + 12)
  const y = view.getUint16(at + 14)
  if (unit === 1) return { x, y, unit: 'inch', dpiX: x, dpiY: y } satisfies Density
  if (unit === 2) {
    return {
      x,
      y,
      unit: 'centimeter',
      dpiX: Math.round(x * CENTIMETERS_PER_INCH),
      dpiY: Math.round(y * CENTIMETERS_PER_INCH),
    } satisfies Density
  }
  return { x, y, unit: 'aspect' } satisfies Density
}

/** Adobe `APP14`: 'Adobe', version, two flag words, then the color transform. */
const readApp14 = (bytes: Uint8Array, at: number, length: number) => {
  if (length < 12 || at + 2 + length > bytes.length || ascii(bytes, at + 4, at + 9) !== 'Adobe') {
    return undefined
  }
  return bytes[at + 2 + length - 1]!
}

const parseJpeg = (bytes: Uint8Array, view: DataView): JpegImageHeader | undefined => {
  let offset = 2
  let density: Density | undefined
  let adobeTransform: number | undefined
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]!
    if (marker === 0xff) {
      offset += 1 // fill byte (T.81 §B.1.1.2): any number may precede a marker
      continue
    }
    // 0xFF00 is a stuffed byte and belongs only inside entropy-coded data; SOS or EOI before
    // any frame header means there is no frame to read.
    if (marker === 0x00 || marker === 0xda || marker === 0xd9) return undefined
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2 // standalone markers carry no length
      continue
    }
    if (offset + 4 > bytes.length) break
    const length = view.getUint16(offset + 2)
    if (length < 2) return undefined
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof) {
      if (offset + 10 > bytes.length) break
      return {
        format: 'jpeg',
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
        alpha: 'absent', // JPEG has no alpha channel; SOF settles it
        precision: bytes[offset + 4]!,
        components: bytes[offset + 9]!,
        pixelDataOffset: offset,
        ...(density ? { density } : {}),
        ...(adobeTransform === undefined ? {} : { adobeTransform }),
      }
    }
    if (marker === 0xe0) density = readApp0(bytes, view, offset, length) ?? density
    if (marker === 0xee) adobeTransform = readApp14(bytes, offset, length) ?? adobeTransform
    offset += 2 + length
  }
  return undefined
}

/** Parse what the first bytes of a PNG or JPEG say about the image. Pure; exported for tests. */
export const parseImageHeader = (bytes: Uint8Array): ImageHeader | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 33 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return parsePng(bytes, view)
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes, view)
  return undefined
}
