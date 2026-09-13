import { Schema } from 'effect'
import { HEADER_BYTES, PIXEL_DATA_MARKER_BYTES, type ImageHeader } from './image-header.js'
import type { PrintfileSpec } from './spec.js'

/**
 * Deviation (CONTEXT.md): the file is valid and sellable, but departs from what
 * the protocol documents or the provider promotes. Recorded and surfaced to the
 * Operator, never blocking, never an Alarm.
 *
 * A code names what was **seen**; the list it lives in names what we **do**
 * about it. `color_type` therefore appears here and in `InvalidReason`: a
 * palette PNG is refused, a grayscale one deviates.
 *
 * One rule list, so Validation, `printfile check`, the conformance suite and an
 * Engine developer's Preflight all say the same thing about the same file.
 */
export const DeviationCode = Schema.Literal(
  'color_undeclared',
  'color_type',
  'gamma',
  'icc_unseen',
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

/** What the container calls its resolution stamp, with no article: the sentences supply their own. */
const stamp = (header: ImageHeader) =>
  header.format === 'png' ? 'pHYs chunk' : 'JFIF APP0 density'

/**
 * Why a wrong stamp is worth a line at all: the provider's Smart Image Tool
 * silently upscales a file stamped between 38 and 149 dpi
 * (`docs/audit/printfile-requirements.md`).
 */
const UPSCALE = 'and a provider reading that stamp may silently upscale the file'

/** `gAMA` holds the gamma scaled by 100 000; sRGB's 1/2.2 is 45455. */
const SRGB_GAMA = 45455
/** Encoders round the sRGB gamma differently (45000, 45455, 45456); 5 % is "meant sRGB". */
const GAMA_TOLERANCE = SRGB_GAMA * 0.05

const RULES: readonly DeviationRule[] = [
  {
    code: 'color_type',
    check: (header) => {
      if (header.format === 'png') {
        // 3 (palette) is a refusal, not a Deviation; 2 and 6 are what the protocol asks for.
        return header.colorType === 0 || header.colorType === 4
          ? `the PNG is grayscale (color type ${header.colorType}); Printfiles are RGB, and a grayscale file prints as one`
          : undefined
      }
      // Four channels are the color_space refusal's business; saying it twice helps nobody.
      return header.components === 1
        ? 'the JPEG has 1 channel (grayscale); Printfiles are three-channel sRGB'
        : undefined
    },
  },
  {
    code: 'color_undeclared',
    check: (header) => {
      if (header.format !== 'png' || !sawWholeTable(header)) return undefined
      return header.chunks.some((c) => c === 'sRGB' || c === 'gAMA' || c === 'iCCP')
        ? undefined
        : 'the PNG declares no color space; write an sRGB chunk (or embed the sRGB ICC profile), because Printfiles are sRGB'
    },
  },
  {
    code: 'gamma',
    check: (header) => {
      if (header.format !== 'png' || header.gamma === undefined) return undefined
      // Precedence (docs/research/printfile-header-limits.md §2.4): a reader that
      // finds sRGB or a profile honors that and never looks at gAMA.
      if (header.chunks.includes('sRGB') || header.chunks.includes('iCCP')) return undefined
      if (Math.abs(header.gamma - SRGB_GAMA) <= GAMA_TOLERANCE) return undefined
      const inverse = Math.round((100_000 / header.gamma) * 100) / 100
      return `the PNG declares gamma 1/${inverse} with no sRGB chunk or profile; write gAMA ${SRGB_GAMA} (sRGB), or declare the space`
    },
  },
  {
    code: 'icc_unseen',
    check: (header) => {
      if (header.format !== 'png' || !header.iccProfile) return undefined
      // Nothing in the Spec binds the profile's identity, so `unseen` deviates
      // here where an unseen alpha refuses: `unseen` refuses only where the Spec binds.
      return header.iccProfile.colorSpace === 'unseen'
        ? `the PNG embeds an ICC profile named "${header.iccProfile.name}" that Pressline could not read within its ${HEADER_BYTES / 1024} KiB window; which color space it declares is unknown`
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
        return `the file states ${found.x}×${found.y} dots per ${found.unit}; stamp a ${stamp(header)} of ${spec.dpi} dpi instead`
      }
      return found.dpiX === spec.dpi && found.dpiY === spec.dpi
        ? undefined
        : `the file is stamped ${found.dpiX}×${found.dpiY} dpi; this placement prints at ${spec.dpi} dpi, ${UPSCALE}`
    },
  },
  {
    code: 'header_window',
    check: (header) => {
      const before = header.format === 'png' ? 'chunk table' : 'segments'
      const advice = `Pressline reads only the first ${HEADER_BYTES / 1024} KiB of a Printfile; keep the ${before} before it smaller, or what is past the window stays unseen`
      const offset = header.pixelDataOffset
      // The bytes ran out before the pixel data. On the bridge's own windowed
      // read that is exactly the row's case, and the only way it can be seen:
      // an offset it never reached is an offset it cannot name.
      if (offset === undefined) {
        return `the image data was not reached in the bytes read, so the ${before} runs past them; ${advice}`
      }
      // The marker has to fit inside the window, not merely start there: one that
      // straddles the end leaves Pressline's read exactly as blind.
      if (offset + PIXEL_DATA_MARKER_BYTES[header.format] <= HEADER_BYTES) return undefined
      return `the image data starts ${offset} bytes in, and ${advice}`
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
