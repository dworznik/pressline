import {
  checkPrintfile,
  describeHeader,
  deviations,
  formatInspection,
  HEADER_BYTES,
  inspectImageHeader,
  inspectionFails,
  PrintfileInvalid,
  UNREADABLE_HEADER,
  type ImageHeader,
  type Inspection,
} from '@pressline/contract'
import { Effect } from 'effect'
import { specSummary, type NamedSpec } from './spec-source.js'

/**
 * Preflight (CONTEXT.md): an Engine developer's local check of a Printfile
 * against a Printfile Spec and the protocol's file requirements, before the
 * file is hosted. It reports what Validation would refuse and any Deviations,
 * and guarantees nothing to anyone but the developer.
 *
 * Bytes in, an Inspection out. Reading the filesystem is the CLI's business and
 * the verdicts are the contract's, so Preflight cannot disagree with the bridge
 * about the same file. Exported as `@pressline/cli/preflight` for an Engine's
 * own test suite, the way `@pressline/conformance` exports its run.
 */

export type { NamedSpec }

/**
 * A fact with no verdict attached: `icc_profile`, a profile Preflight read and
 * nothing refuses; `header_window`, the bridge's 64 KiB read seeing less than
 * the whole file does. Notes are Preflight's alone — the bridge has no whole
 * file to compare its window with.
 */
export interface PreflightNote {
  readonly code: 'icc_profile' | 'header_window'
  readonly message: string
}

/** One file against one Spec. An Inspection with nothing in either list is a file that would sell as written. */
export interface PreflightResult extends Inspection {
  readonly path: string
  /** Size of the whole file; Preflight reads all of it, unlike the bridge. */
  readonly bytes: number
  readonly specHash?: string
  readonly notes: readonly PreflightNote[]
}

/** One line of the report: a result and the Spec it was produced against. */
export interface PreflightEntry {
  readonly result: PreflightResult
  readonly spec?: NamedSpec
}

/** Validation's words for bytes that are no image; a file given no Spec still earns this verdict. */
const UNREADABLE = new PrintfileInvalid({ reason: 'header', message: UNREADABLE_HEADER })

/**
 * What the bridge's read would have seen but the whole-file read did not, in the
 * Engine developer's terms. Silent when both reads agree, which is the common case.
 */
const windowNote = (whole: ImageHeader, seen: ImageHeader | undefined): string | undefined => {
  if (!seen) {
    return `the whole file reads as a ${whole.width}×${whole.height} ${whole.format}, but Pressline reads only the first ${HEADER_BYTES} bytes and finds no readable header in them`
  }
  if (seen.alpha === whole.alpha) return undefined
  return `Pressline reads only the first ${HEADER_BYTES} bytes, which stop before the pixel data: its read sees alpha as ${seen.alpha} where the whole file says ${whole.alpha}`
}

const iccNote = (header: ImageHeader): string | undefined => {
  if (header.format !== 'png' || !header.iccProfile) return undefined
  const { name, compressedBytes, colorSpace } = header.iccProfile
  // CMYK and gray are refusals, and a profile nobody could read is a Deviation:
  // each already names the profile. What is left is a profile nothing says
  // anything about, and the one thing worth adding is what is not checked.
  if (colorSpace !== 'rgb' && colorSpace !== 'other') return undefined
  const declares =
    colorSpace === 'rgb'
      ? 'an RGB color space; which RGB is not checked'
      : 'a color space that is neither RGB, CMYK nor gray'
  return `the PNG embeds an ICC profile named "${name}" (${compressedBytes} bytes, compressed) declaring ${declares}`
}

const note = (code: PreflightNote['code'], message: string | undefined) =>
  message === undefined ? [] : [{ code, message }]

/**
 * Preflight one file. The refusals are judged on the bytes Pressline would
 * read, because that is what Validation would refuse; the Deviations and the
 * reported header come from the whole file, because that is what the developer
 * can fix.
 */
export const runPreflight = (
  file: { readonly path: string; readonly bytes: Uint8Array },
  spec?: NamedSpec,
): Effect.Effect<PreflightResult> =>
  Effect.gen(function* () {
    const header = yield* inspectImageHeader(file.bytes)
    const withinWindow = file.bytes.length <= HEADER_BYTES
    const seen = withinWindow
      ? header
      : yield* inspectImageHeader(file.bytes.subarray(0, HEADER_BYTES))
    return {
      path: file.path,
      bytes: file.bytes.length,
      ...(spec?.specHash === undefined ? {} : { specHash: spec.specHash }),
      ...(header ? { header } : {}),
      // Without a Spec there is no rule to break but one, and a file still
      // answers for itself: unreadable bytes are unreadable.
      invalid: spec ? checkPrintfile(seen, spec.spec) : header ? [] : [UNREADABLE],
      deviations: header ? deviations(header, spec?.spec) : [],
      notes: header
        ? [
            ...note('icc_profile', iccNote(header)),
            ...(withinWindow ? [] : note('header_window', windowNote(header, seen))),
          ]
        : [],
    }
  })

/**
 * Promise form, for an Engine's own test suite: an Engine developer should not
 * have to reach for Effect to check the file they just rendered. The same shape
 * `@pressline/conformance` exports beside its own run.
 */
export const preflight = (
  file: { readonly path: string; readonly bytes: Uint8Array },
  spec?: NamedSpec,
): Promise<PreflightResult> => Effect.runPromise(runPreflight(file, spec))

/**
 * How the report's arithmetic is done, so the summary line and the exit code
 * cannot disagree — and it is the shared exit rule counted per file, so
 * Preflight cannot disagree with `printfile check` or `engine conformance`
 * either: a file is refused when it would fail without `--strict`, and
 * deviating when only `--strict` would fail it.
 */
export const tally = (entries: readonly PreflightEntry[]) => {
  const refused = entries.filter((e) => inspectionFails(e.result)).length
  const deviating = entries.filter(
    (e) => !inspectionFails(e.result) && inspectionFails(e.result, true),
  ).length
  return { total: entries.length, refused, deviating, clean: entries.length - refused - deviating }
}

// ---- the report -------------------------------------------------------------

const describeSpec = (spec: NamedSpec) =>
  `Spec${spec.source ? ` ${spec.source}` : ''}: ${specSummary(spec.spec, spec.specHash)}`

const block = ({ result }: PreflightEntry): string[] => [
  `File ${result.path}: ${result.header ? describeHeader(result.header) : UNREADABLE_HEADER}, ${result.bytes} bytes`,
  ...formatInspection(result),
  ...result.notes.map((n) => `  · ${n.message}`),
]

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/**
 * The human report: the Spec, one block per file, then one line of arithmetic
 * over the file-and-Spec pairs, which is why it multiplies. A run with no Spec
 * says so once, before the first block.
 */
export const formatPreflight = (entries: readonly PreflightEntry[]): string[] => {
  const withSpec = entries.some((e) => e.spec)
  const files = new Set(entries.map((e) => e.result.path)).size
  const specs = new Set(entries.map((e) => e.spec?.specHash ?? e.spec?.source)).size
  const lines = withSpec ? [] : ['no Spec: dimensions, alpha and DPI not checked']
  // The Spec line heads its blocks and is not repeated: many files against one
  // Spec should read as one report, not as the same line N times.
  let heading: string | undefined
  for (const entry of entries) {
    const line = entry.spec ? describeSpec(entry.spec) : undefined
    if (line !== undefined && line !== heading) lines.push(line)
    heading = line
    lines.push(...block(entry))
  }
  const { refused, deviating, clean } = tally(entries)
  lines.push(
    `${count(files, 'file')} ${withSpec ? `× ${count(specs, 'Spec')}` : ', no Spec'}: ${refused} refused, ${deviating} with Deviations, ${clean} clean.`,
  )
  return lines
}
