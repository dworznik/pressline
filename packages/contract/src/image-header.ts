import { Duration, Effect, Schema } from 'effect'

/**
 * The header read: everything Pressline knows about a Printfile without
 * decoding a single pixel (ADR-0002). One parser, shared by Validation, the
 * conformance suite, `printfile check` and an Engine developer's Preflight, so
 * none of them can disagree about what a file says.
 *
 * The window is `HEADER_BYTES` when the bytes come off the wire; a local file
 * read whole gives the same parser more to see, which is exactly how Preflight
 * spots a file whose chunk table would outrun Pressline's read.
 *
 * The types are Schemas because an `ImageHeader` travels: the operator API
 * publishes it and the Inspection record stores it as JSON. One definition, so
 * the parser and the wire cannot drift apart.
 */

export const HEADER_BYTES = 64 * 1024

/**
 * Bytes the parser needs at `pixelDataOffset` to read what is there: a PNG
 * chunk header names `IDAT` in 8, a JPEG frame header gives its size in 10. A
 * marker that starts inside the window but ends past it is no more use than one
 * that never arrives.
 */
export const PIXEL_DATA_MARKER_BYTES = { png: 8, jpeg: 10 } as const

/**
 * What the header read says about transparency. `unseen` means the chunk
 * table ran past the window before IDAT, so the read proved nothing either
 * way (#117); callers must not treat it as `absent`.
 */
export const AlphaObservation = Schema.Literal('present', 'absent', 'unseen')
export type AlphaObservation = typeof AlphaObservation.Type

/**
 * The physical resolution a file stamps on itself: PNG's `pHYs`, JPEG's JFIF
 * `APP0`. `x` and `y` are in the file's own unit; `dpiX`/`dpiY` are those
 * values in dots per inch, rounded, and are absent when the unit is not a
 * physical one.
 */
export const Density = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  unit: Schema.Literal('meter', 'inch', 'centimeter', 'aspect'),
  dpiX: Schema.optional(Schema.Int),
  dpiY: Schema.optional(Schema.Int),
})
export type Density = typeof Density.Type

/**
 * What an `iCCP` chunk carries. `colorSpace` is the profile's own data color
 * space, read from the first bytes of the inflated profile by
 * `inspectImageHeader`; `unseen` is what a bare parse reports and what every
 * way of failing to read it collapses to (#116).
 *
 * `name` is for a human reading a message. **No rule may branch on it**: a
 * profile's name is free text an encoder chose, and two files with the same
 * name may declare different spaces.
 */
export const IccProfile = Schema.Struct({
  name: Schema.String,
  /** Size of the profile as stored, still deflated. */
  compressedBytes: Schema.Int,
  /** Byte offset, from the start of the file, of the chunk's data (the profile name). */
  offset: Schema.Int,
  colorSpace: Schema.Literal('rgb', 'cmyk', 'gray', 'other', 'unseen'),
})
export type IccProfile = typeof IccProfile.Type

const headerFields = {
  width: Schema.Int,
  height: Schema.Int,
  alpha: AlphaObservation,
  /**
   * Byte offset, from the start of the file, where the pixel data begins: the
   * first `IDAT` in a PNG, the frame header (`SOF`) in a JPEG. Everything the
   * header read can ever see lies before it. Absent when the bytes handed to
   * the parser ended first.
   */
  pixelDataOffset: Schema.optional(Schema.Int),
  density: Schema.optional(Density),
}

export const PngImageHeader = Schema.Struct({
  format: Schema.Literal('png'),
  ...headerFields,
  /** Bits per channel, `IHDR` byte 24. */
  bitDepth: Schema.Int,
  /** `IHDR` byte 25: 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA. */
  colorType: Schema.Int,
  /** `IHDR` byte 28: Adam7 interlacing. */
  interlaced: Schema.Boolean,
  /** Chunk types seen between `IHDR` and the first `IDAT`, in file order. */
  chunks: Schema.Array(Schema.String),
  /** The `gAMA` value: the gamma scaled by 100 000, so sRGB's 1/2.2 is 45455. */
  gamma: Schema.optional(Schema.Int),
  iccProfile: Schema.optional(IccProfile),
})
export type PngImageHeader = typeof PngImageHeader.Type

export const JpegImageHeader = Schema.Struct({
  format: Schema.Literal('jpeg'),
  ...headerFields,
  /** Bits per sample, from the frame header. */
  precision: Schema.Int,
  /** Channels in the frame: 1 grayscale, 3 YCbCr, 4 CMYK or YCCK. */
  components: Schema.Int,
  /** The Adobe `APP14` color transform, when that segment is present: 0 none (RGB or CMYK), 1 YCbCr, 2 YCCK. */
  adobeTransform: Schema.optional(Schema.Int),
})
export type JpegImageHeader = typeof JpegImageHeader.Type

export const ImageHeader = Schema.Union(PngImageHeader, JpegImageHeader)
export type ImageHeader = typeof ImageHeader.Type

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
  readonly gamma?: number
  readonly iccProfile?: IccProfile
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

/** `gAMA`: the gamma scaled by 100 000, four bytes. PNG §11.3.3.2. */
const readGama = (view: DataView, at: number, length: number) =>
  length < 4 || at + 12 > view.byteLength ? undefined : view.getUint32(at + 8)

/**
 * `iCCP`: a profile name (1–79 bytes), a NUL, the compression method, then the
 * deflated profile. PNG §11.3.3.3. The parse stops at the name; what the
 * profile declares is `inspectImageHeader`'s business, and until it has run the
 * honest answer is `unseen`.
 */
const readIccp = (bytes: Uint8Array, at: number, length: number): IccProfile | undefined => {
  const start = at + 8
  const end = Math.min(start + Math.min(length, 80), bytes.length)
  const nul = bytes.subarray(start, end).indexOf(0)
  if (nul <= 0) return undefined
  return {
    name: ascii(bytes, start, start + nul),
    compressedBytes: Math.max(length - nul - 2, 0),
    offset: start,
    colorSpace: 'unseen',
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
  let gamma: number | undefined
  let iccProfile: IccProfile | undefined
  let offset = 8 + 12 + 13 // the signature and IHDR, both already parsed
  const found = () => ({
    ...(density ? { density } : {}),
    ...(gamma === undefined ? {} : { gamma }),
    ...(iccProfile ? { iccProfile } : {}),
  })
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
        ...found(),
      }
    }
    chunks.push(type)
    if (type === 'tRNS') alpha = 'present'
    if (type === 'pHYs') density = readPhys(view, offset, length) ?? density
    if (type === 'gAMA') gamma = readGama(view, offset, length) ?? gamma
    if (type === 'iCCP') iccProfile = readIccp(bytes, offset, length) ?? iccProfile
    offset += 12 + length
  }
  return { alpha, chunks, ...found() }
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
    ...(table.gamma === undefined ? {} : { gamma: table.gamma }),
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

/**
 * Adobe `APP14`: 'Adobe'(5), version(2), two flag words(4), then the color
 * transform — a fixed position, so a segment padded past its 14 bytes still
 * reads correctly and a truncated one is refused rather than guessed at.
 */
const readApp14 = (bytes: Uint8Array, at: number, length: number) => {
  if (length < 14 || at + 16 > bytes.length || ascii(bytes, at + 4, at + 9) !== 'Adobe') {
    return undefined
  }
  return bytes[at + 15]!
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

// ---- the bounded iCCP inflate (ADR-0002 as amended, #116) -------------------

/**
 * Compressed bytes fed to the inflater. An ICC profile's first 132 bytes are
 * its header, and 128 compressed bytes were measured to be enough to recover
 * them from every profile in the sample; 512 is that with room to spare, and
 * small enough that a hostile file cannot make this expensive.
 */
export const ICC_INFLATE_INPUT_BYTES = 512
/**
 * Bytes of profile the read needs: the data color space ends at 20, and the
 * `acsp` signature at 40. Both, always — reading the space out of 20 bytes
 * that were never proved to be an ICC profile is how a refusal gets made on
 * bytes nobody identified.
 */
const ICC_HEADER_BYTES = 40
/**
 * A decompressor that produces nothing must not hang the read: a prefix can be
 * just the two-byte zlib header, which will never yield an output chunk. Half a
 * kilobyte inflates in microseconds, so a second is pure headroom. It is an
 * `Effect` timeout, so the wait is on the `Clock` a test can advance.
 */
const ICC_INFLATE_TIMEOUT = Duration.seconds(1)

/** A decompressor and the two ends of it, released together whichever way the read ends. */
const openInflater = Effect.acquireRelease(
  Effect.sync(() => {
    const stream = new DecompressionStream('deflate') // ban-check-ignore: the one sanctioned inflate (ADR-0002)
    return { writer: stream.writable.getWriter(), reader: stream.readable.getReader() }
  }),
  ({ reader, writer }) =>
    Effect.sync(() => {
      reader.cancel().catch(() => undefined)
      writer.abort().catch(() => undefined)
    }),
)

/**
 * The first chunk the platform's inflater produces from a *prefix* of a deflate
 * stream. The stream is never closed, because it never ends: the caller hands
 * over the first few hundred bytes of a profile and wants the first output back.
 * Anything else — a corrupt stream, a prefix too short to produce output, a read
 * that never resolves — is `undefined`, which the caller reads as "unseen". A
 * decompression failure never becomes a refusal.
 */
const inflatePrefix = (compressed: Uint8Array): Effect.Effect<Uint8Array | undefined> =>
  Effect.gen(function* () {
    const { reader, writer } = yield* openInflater
    // A prefix ends mid-stream, so the writable side always errors; that is expected, not a fault.
    writer.closed.catch(() => undefined)
    // Copied into its own buffer: at most `ICC_INFLATE_INPUT_BYTES`, and a view
    // onto a shared buffer is not a `BufferSource`.
    writer.write(new Uint8Array(compressed)).catch(() => undefined)
    return yield* Effect.tryPromise(() => reader.read().then((r) => r.value))
  }).pipe(
    Effect.scoped,
    Effect.timeout(ICC_INFLATE_TIMEOUT),
    Effect.orElseSucceed(() => undefined),
  )

/** ICC.1:2010 §7.2: the profile header names its data color space at byte 16 and itself at byte 36. */
const SPACES: Record<string, IccProfile['colorSpace']> = {
  'RGB ': 'rgb',
  CMYK: 'cmyk',
  GRAY: 'gray',
}

/**
 * What the embedded profile says its data color space is. Every way of not
 * finding out — the chunk straddles the window, a compression method PNG does
 * not define, a stream that will not inflate, too little profile to read, bytes
 * that carry no `acsp` signature and so are no ICC profile — collapses to
 * `unseen`, because they are the same fact to every caller.
 */
const readProfileColorSpace = (
  bytes: Uint8Array,
  icc: IccProfile,
): Effect.Effect<IccProfile['colorSpace']> =>
  Effect.gen(function* () {
    const methodAt = icc.offset + icc.name.length + 1
    const profileAt = methodAt + 1
    if (methodAt >= bytes.length || bytes[methodAt] !== 0) return 'unseen'
    const end = Math.min(
      profileAt + ICC_INFLATE_INPUT_BYTES,
      profileAt + icc.compressedBytes,
      bytes.length,
    )
    if (end <= profileAt) return 'unseen'
    const out = yield* inflatePrefix(bytes.subarray(profileAt, end))
    if (!out || out.length < ICC_HEADER_BYTES) return 'unseen'
    if (ascii(out, 36, ICC_HEADER_BYTES) !== 'acsp') return 'unseen'
    return SPACES[ascii(out, 16, 20)] ?? 'other'
  })

/**
 * The header read as Validation and Preflight make it: `parseImageHeader`, then
 * the bounded inflate that turns an `iCCP` chunk's `colorSpace` from `unseen`
 * into what the profile actually declares. Inspecting a header this way is
 * header inspection, not decoding (ADR-0002, amended by #138): no pixel is
 * touched, nothing outside the 64 KiB window is read, and at most
 * `ICC_INFLATE_INPUT_BYTES` compressed bytes are handed to the inflater.
 *
 * JPEG's `APP2` ICC profile is never inflated or scanned: the frame header
 * already proves how many channels the image has.
 */
export const inspectImageHeader = (bytes: Uint8Array): Effect.Effect<ImageHeader | undefined> =>
  Effect.gen(function* () {
    const header = parseImageHeader(bytes)
    if (!header || header.format !== 'png' || !header.iccProfile) return header
    const colorSpace = yield* readProfileColorSpace(bytes, header.iccProfile)
    return { ...header, iccProfile: { ...header.iccProfile, colorSpace } }
  })
