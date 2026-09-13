import {
  checkPrintfile,
  deviations,
  HEADER_BYTES,
  parseImageHeader,
  type Deviation,
  type ImageHeader,
  type InvalidReason,
} from '@pressline/contract'
import { specSummary, type NamedSpec } from './spec-source.js'

/**
 * Preflight (CONTEXT.md): an Engine developer's local check of a Printfile
 * against a Printfile Spec and the protocol's file requirements, before the
 * file is hosted. It reports what Validation would refuse and any Deviations,
 * and guarantees nothing to anyone but the developer.
 *
 * Pure: bytes in, a report out. Reading the filesystem is the CLI's business
 * and the verdicts are the contract's, so Preflight cannot disagree with the
 * bridge about the same file. Exported as `@pressline/cli/preflight` for an
 * Engine's own test suite, the way `@pressline/conformance` exports its run.
 */

export type { NamedSpec }

/** One thing Validation would refuse, in the words the bridge would use. */
export interface PreflightProblem {
  readonly reason: InvalidReason
  readonly message: string
}

/**
 * A fact with no verdict attached: `icc_profile`, an embedded profile nobody
 * has identified yet (#116); `header_window`, the bridge's 64 KiB read seeing
 * less than the whole file does.
 */
export interface PreflightNote {
  readonly code: 'icc_profile' | 'header_window'
  readonly message: string
}

/** One file against one Spec. Both lists empty is a file that would sell as written. */
export interface PreflightResult {
  readonly path: string
  /** Size of the whole file; Preflight reads all of it, unlike the bridge. */
  readonly bytes: number
  readonly specHash?: string
  /** What the whole file says about itself; absent when the bytes are no image. */
  readonly header?: ImageHeader
  readonly invalid: readonly PreflightProblem[]
  readonly deviations: readonly Deviation[]
  readonly notes: readonly PreflightNote[]
}

/** One line of the report: a result and the Spec it was produced against. */
export interface PreflightEntry {
  readonly result: PreflightResult
  readonly spec?: NamedSpec
}

/** Validation's words for bytes that are no image; a file given no Spec still earns this verdict. */
const UNREADABLE: PreflightProblem = {
  reason: 'header',
  message: 'not a readable PNG or JPEG header',
}

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
  const { name, compressedBytes } = header.iccProfile
  return `the PNG embeds an ICC profile named "${name}" (${compressedBytes} bytes, compressed); which profile it is is not checked`
}

const note = (code: PreflightNote['code'], message: string | undefined) =>
  message === undefined ? [] : [{ code, message }]

/**
 * Preflight one file. The refusals are judged on the bytes Pressline would
 * read, because that is what Validation would refuse; the Deviations and the
 * reported header come from the whole file, because that is what the developer
 * can fix.
 */
export const preflight = (
  file: { readonly path: string; readonly bytes: Uint8Array },
  spec?: NamedSpec,
): PreflightResult => {
  const header = parseImageHeader(file.bytes)
  const withinWindow = file.bytes.length <= HEADER_BYTES
  const seen = withinWindow ? header : parseImageHeader(file.bytes.subarray(0, HEADER_BYTES))
  const refusal = spec ? checkPrintfile(seen, spec.spec) : undefined
  const invalid = spec
    ? refusal
      ? [{ reason: refusal.reason, message: refusal.message }]
      : []
    : header
      ? []
      : [UNREADABLE]
  return {
    path: file.path,
    bytes: file.bytes.length,
    ...(spec?.specHash === undefined ? {} : { specHash: spec.specHash }),
    ...(header ? { header } : {}),
    invalid,
    deviations: header ? deviations(header, spec?.spec) : [],
    notes: header
      ? [
          ...note('icc_profile', iccNote(header)),
          ...(withinWindow ? [] : note('header_window', windowNote(header, seen))),
        ]
      : [],
  }
}

/** How the report's arithmetic is done, so the summary line and the exit code cannot disagree. */
export const tally = (entries: readonly PreflightEntry[]) => {
  const refused = entries.filter((e) => e.result.invalid.length > 0).length
  const deviating = entries.filter(
    (e) => e.result.invalid.length === 0 && e.result.deviations.length > 0,
  ).length
  return { total: entries.length, refused, deviating, clean: entries.length - refused - deviating }
}

// ---- the report -------------------------------------------------------------

const describeSpec = (spec: NamedSpec) =>
  `Spec${spec.source ? ` ${spec.source}` : ''}: ${specSummary(spec.spec, spec.specHash)}`

const describeDensity = (header: ImageHeader) => {
  const d = header.density
  if (!d) return 'no DPI stamped'
  if (d.dpiX === undefined || d.dpiY === undefined) return `${d.x}:${d.y} aspect only, no DPI`
  return `${d.dpiX}×${d.dpiY} dpi`
}

const describeHeader = (header: ImageHeader) =>
  header.format === 'png'
    ? `png ${header.width}×${header.height}, ${header.bitDepth}-bit color type ${header.colorType}${header.interlaced ? ', interlaced' : ''}, alpha ${header.alpha}, ${describeDensity(header)}`
    : `jpeg ${header.width}×${header.height}, ${header.precision}-bit, ${header.components} channel(s), alpha ${header.alpha}, ${describeDensity(header)}`

const block = ({ result }: PreflightEntry): string[] => [
  `File ${result.path}: ${result.header ? describeHeader(result.header) : UNREADABLE.message}, ${result.bytes} bytes`,
  ...(result.invalid.length === 0
    ? ['  ✓ nothing Validation would refuse']
    : result.invalid.map((p) => `  ✗ ${p.reason}: ${p.message}`)),
  ...result.deviations.map((d) => `  ⚠ ${d.code}: ${d.message}`),
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
