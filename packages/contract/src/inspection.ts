import type { Deviation } from './deviation.js'
import type { ImageHeader } from './image-header.js'
import type { PrintfileInvalid } from './validate.js'

/**
 * Inspection (CONTEXT.md): what looking at one Printfile concluded — what its
 * header said, what Validation would refuse, and which Deviations it carries.
 * The same shape whoever looked and however the bytes arrived, so Validation,
 * `printfile check`, Conformance and Preflight can never describe the same file
 * differently.
 *
 * `header` is absent when the bytes were no readable image; `invalid` empty
 * means the file is sellable.
 */
export interface Inspection {
  readonly header?: ImageHeader
  readonly invalid: readonly PrintfileInvalid[]
  readonly deviations: readonly Deviation[]
}

const describeDensity = (header: ImageHeader) => {
  const d = header.density
  if (!d) return 'no DPI stamped'
  if (d.dpiX === undefined || d.dpiY === undefined) return `${d.x}:${d.y} aspect only, no DPI`
  return `${d.dpiX}×${d.dpiY} dpi`
}

/** Words for bytes that are no image: Validation's own, so every command says it the same way. */
export const UNREADABLE_HEADER = 'not a readable PNG or JPEG header'

/**
 * One line describing what the file says about itself:
 * `png 1800×2400, 8-bit color type 6, alpha present, 150×150 dpi`.
 */
export const describeHeader = (header: ImageHeader): string =>
  header.format === 'png'
    ? `png ${header.width}×${header.height}, ${header.bitDepth}-bit color type ${header.colorType}${header.interlaced ? ', interlaced' : ''}, alpha ${header.alpha}, ${describeDensity(header)}`
    : `jpeg ${header.width}×${header.height}, ${header.precision}-bit, ${header.components} channel(s), alpha ${header.alpha}, ${describeDensity(header)}`

/**
 * All a printer needs of an Inspection, and all the exit rule needs: what was
 * seen, and what to say about it. Weaker than `Inspection` on purpose — a CLI
 * reading an instance newer than itself must print a code it has never heard
 * of rather than refuse the whole answer.
 */
export interface InspectionLines {
  readonly invalid: readonly { readonly reason: string; readonly message: string }[]
  readonly deviations: readonly { readonly code: string; readonly message: string }[]
}

/**
 * The Inspection as an Engine developer reads it: one `✗` line per refusal,
 * one `⚠` line per Deviation, each indented under whatever named the file. The
 * one renderer `pressline engine preflight`, `pressline printfile check` and
 * `pressline engine conformance` all print, which is why it lives here and not
 * in the CLI: the conformance suite cannot depend on the CLI.
 *
 * `affirmClean` adds the line that says a file has nothing against it, which a
 * report of many files needs and a check that already printed its own `✓` does
 * not.
 */
export const formatInspection = (
  inspection: InspectionLines,
  { affirmClean = true } = {},
): string[] => [
  ...(inspection.invalid.length === 0
    ? affirmClean
      ? ['  ✓ nothing Validation would refuse']
      : []
    : inspection.invalid.map((p) => `  ✗ ${p.reason}: ${p.message}`)),
  ...inspection.deviations.map((d) => `  ⚠ ${d.code}: ${d.message}`),
]

/**
 * How a command exits on an Inspection: 1 for anything Validation would refuse,
 * 0 with Deviations listed, and under `--strict` a Deviation fails too. One
 * rule, so the three commands cannot disagree about the same file.
 */
export const inspectionFails = (inspection: InspectionLines, strict = false): boolean =>
  inspection.invalid.length > 0 || (strict && inspection.deviations.length > 0)
