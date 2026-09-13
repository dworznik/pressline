import { Schema } from 'effect'
import { HEADER_BYTES, PIXEL_DATA_MARKER_BYTES, type ImageHeader } from './image-header.js'
import type { PrintfileSpec } from './spec.js'

/**
 * Deviation (CONTEXT.md): the file is valid and sellable, but departs from what
 * the protocol documents. Recorded and surfaced, never blocking — until #110
 * promotes a row to a rejection, every row below is a Deviation.
 *
 * One rule list, so Validation, `printfile check`, the conformance suite and an
 * Engine developer's Preflight all say the same thing about the same file.
 */
export const DeviationCode = Schema.Literal(
  'bit_depth',
  'interlaced',
  'color_space',
  'cmyk',
  'dpi_missing',
  'dpi_mismatch',
  'header_window',
)
export type DeviationCode = typeof DeviationCode.Type

export const Deviation = Schema.Struct({
  code: DeviationCode,
  /** What an Engine developer can act on: what the file says, and what to write instead. */
  message: Schema.String,
})
export type Deviation = typeof Deviation.Type

/**
 * One rule: given a header and, when there is one, the Spec the file was
 * rendered for, the message to record — or `undefined` when the row is met, or
 * when the bytes the parser saw cannot settle it.
 */
interface DeviationRule {
  readonly code: DeviationCode
  readonly check: (header: ImageHeader, spec?: PrintfileSpec) => string | undefined
}

/** A PNG whose window ended before IDAT has an incomplete chunk list: absence proves nothing. */
const sawWholeTable = (header: ImageHeader) =>
  header.format === 'jpeg' || header.pixelDataOffset !== undefined

const dpiOf = (spec?: PrintfileSpec) => (spec ? `${spec.dpi} dpi` : "the Spec's DPI")

/** The unit a container states a real resolution in: pixels per meter in PNG, dots per inch in JFIF. */
const physicalUnit = (header: ImageHeader) => (header.format === 'png' ? 'meter' : 'inch')

const stamp = (header: ImageHeader) =>
  header.format === 'png' ? 'a pHYs chunk' : 'a JFIF APP0 density'

const RULES: readonly DeviationRule[] = [
  {
    code: 'bit_depth',
    check: (header) => {
      if (header.format === 'png') {
        return header.bitDepth === 8
          ? undefined
          : `the PNG declares a ${header.bitDepth}-bit depth; Printfiles are 8 bits per channel`
      }
      return header.precision === 8
        ? undefined
        : `the JPEG declares ${header.precision}-bit samples; Printfiles are 8 bits per channel`
    },
  },
  {
    code: 'interlaced',
    check: (header) =>
      header.format === 'png' && header.interlaced
        ? 'the PNG is interlaced (Adam7); write it non-interlaced, so the Printfile streams in one pass'
        : undefined,
  },
  {
    code: 'color_space',
    check: (header) => {
      if (header.format === 'png') {
        if (!sawWholeTable(header)) return undefined
        return header.chunks.includes('sRGB') || header.chunks.includes('iCCP')
          ? undefined
          : 'the PNG declares no color space; write an sRGB chunk (or embed an sRGB ICC profile), because Printfiles are sRGB'
      }
      // A four-channel or YCCK JPEG is the CMYK row's business; saying it twice helps nobody.
      if (header.components === 4 || header.adobeTransform === 2) return undefined
      return header.components === 3
        ? undefined
        : `the JPEG has ${header.components} channel(s); Printfiles are three-channel sRGB`
    },
  },
  {
    code: 'cmyk',
    check: (header) => {
      if (header.format === 'png') return undefined
      if (header.components === 4) {
        return 'the JPEG has four channels, so it is CMYK or YCCK; Printfiles are sRGB'
      }
      return header.adobeTransform === 2
        ? 'the JPEG declares an Adobe YCCK transform, so it is CMYK; Printfiles are sRGB'
        : undefined
    },
  },
  {
    code: 'dpi_missing',
    check: (header, spec) => {
      if (!sawWholeTable(header)) return undefined
      const found = header.density
      if (!found) {
        return `the file carries no ${stamp(header)}, so it states no print resolution; stamp ${dpiOf(spec)} into it`
      }
      return found.unit === 'aspect'
        ? `the file's ${stamp(header)} states an aspect ratio, not a physical resolution; stamp ${dpiOf(spec)} into it`
        : undefined
    },
  },
  {
    code: 'dpi_mismatch',
    check: (header, spec) => {
      const found = header.density
      if (!spec || !found || found.unit === 'aspect') return undefined
      if (found.unit !== physicalUnit(header)) {
        return `the file states ${found.x}×${found.y} dots per ${found.unit}; stamp ${stamp(header)} of ${spec.dpi} dpi instead`
      }
      return found.dpiX === spec.dpi && found.dpiY === spec.dpi
        ? undefined
        : `the file is stamped ${found.dpiX}×${found.dpiY} dpi; this placement prints at ${spec.dpi} dpi`
    },
  },
  {
    code: 'header_window',
    check: (header) => {
      const offset = header.pixelDataOffset
      // The marker has to fit inside the window, not merely start there: one that
      // straddles the end leaves Pressline's read exactly as blind.
      if (offset === undefined || offset + PIXEL_DATA_MARKER_BYTES[header.format] <= HEADER_BYTES) {
        return undefined
      }
      const before = header.format === 'png' ? 'chunk table' : 'segments'
      return `the image data starts ${offset} bytes in, and Pressline reads only the first ${HEADER_BYTES / 1024} KiB of a Printfile; keep the ${before} before it smaller, or what is past the window stays unseen`
    },
  },
]

/**
 * Every documented file requirement this header departs from, in table order.
 * Rows that need a Spec are skipped without one, and a row the parser's bytes
 * cannot settle is skipped rather than guessed at.
 */
export const deviations = (header: ImageHeader, spec?: PrintfileSpec): readonly Deviation[] =>
  RULES.flatMap((rule) => {
    const message = rule.check(header, spec)
    return message === undefined ? [] : [{ code: rule.code, message }]
  })
