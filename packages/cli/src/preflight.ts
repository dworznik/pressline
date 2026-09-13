import {
  checkPrintfile,
  deviations,
  HEADER_BYTES,
  parseImageHeader,
  type Deviation,
  type ImageHeader,
  type InvalidReason,
  type PrintfileSpec,
} from '@pressline/contract'

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

/** The Spec a file is checked against, and how the report names where it came from. */
export interface PreflightSpec {
  readonly spec: PrintfileSpec
  readonly specHash?: string
  /** `tee-black-front/black-m`, or `--spec`. */
  readonly source?: string
}

/** One thing Validation would refuse, in the words the bridge would use. */
export interface PreflightProblem {
  readonly reason: InvalidReason
  readonly message: string
}

/** One file against one Spec. Nothing in either list is a file that would sell. */
export interface PreflightResult {
  readonly path: string
  /** Size of the whole file; Preflight reads all of it, unlike the bridge. */
  readonly bytes: number
  readonly specHash?: string
  /** What the whole file says about itself; absent when the bytes are no image. */
  readonly header?: ImageHeader
  readonly invalid: readonly PreflightProblem[]
  readonly deviations: readonly Deviation[]
  /** Facts that carry no verdict: an ICC profile nobody has identified, a 64 KiB view that differs. */
  readonly notes: readonly string[]
}

/** A result and the Spec it was produced against, in report order. */
export interface PreflightCheck {
  readonly result: PreflightResult
  readonly spec?: PreflightSpec
}

/** Validation's words for bytes that are no image; a file checked against no Spec still earns this verdict. */
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

/**
 * Preflight one file. The refusals are judged on the bytes Pressline would
 * read, because that is what Validation would refuse; the Deviations and the
 * reported header come from the whole file, because that is what the developer
 * can fix.
 */
export const preflight = (
  file: { readonly path: string; readonly bytes: Uint8Array },
  spec?: PreflightSpec,
): PreflightResult => {
  const header = parseImageHeader(file.bytes)
  const seen =
    file.bytes.length <= HEADER_BYTES
      ? header
      : parseImageHeader(file.bytes.subarray(0, HEADER_BYTES))
  const refusal = spec ? checkPrintfile(seen, spec.spec) : undefined
  const invalid = spec
    ? refusal
      ? [{ reason: refusal.reason, message: refusal.message }]
      : []
    : header
      ? []
      : [UNREADABLE]
  const notes = header
    ? [iccNote(header), seen === header ? undefined : windowNote(header, seen)]
    : []
  return {
    path: file.path,
    bytes: file.bytes.length,
    ...(spec?.specHash === undefined ? {} : { specHash: spec.specHash }),
    ...(header ? { header } : {}),
    invalid,
    deviations: header ? deviations(header, spec?.spec) : [],
    notes: notes.filter((n) => n !== undefined),
  }
}

// ---- the report -------------------------------------------------------------

const describeSpec = (spec: PreflightSpec) => {
  const s = spec.spec
  return [
    `Spec${spec.source ? ` ${spec.source}` : ''}: ${s.width}×${s.height}px @ ${s.dpi} dpi, ${s.formats.join('/')}, alpha ${s.alpha}`,
    spec.specHash ? ` (hash ${spec.specHash.slice(0, 12)}…)` : '',
  ].join('')
}

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

const block = ({ result }: PreflightCheck): string[] => [
  `File ${result.path}: ${result.header ? describeHeader(result.header) : 'not a readable PNG or JPEG header'}, ${result.bytes} bytes`,
  ...(result.invalid.length === 0
    ? ['  ✓ nothing Validation would refuse']
    : result.invalid.map((p) => `  ✗ ${p.reason}: ${p.message}`)),
  ...result.deviations.map((d) => `  ⚠ ${d.code}: ${d.message}`),
  ...result.notes.map((n) => `  · ${n}`),
]

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The human report: one block per file and Spec, then one line of arithmetic.
 * A file with no Spec says so once, before the first block.
 */
export const formatPreflight = (checks: readonly PreflightCheck[]): string[] => {
  const files = new Set(checks.map((c) => c.result.path)).size
  const specs = new Set(checks.map((c) => c.spec?.specHash ?? c.spec?.source)).size
  const refused = checks.filter((c) => c.result.invalid.length > 0).length
  const deviating = checks.filter(
    (c) => c.result.invalid.length === 0 && c.result.deviations.length > 0,
  ).length
  const lines = checks.some((c) => c.spec) ? [] : ['no Spec: dimensions, alpha and DPI not checked']
  // The Spec line heads its blocks and is not repeated: checking many files
  // against one Spec should read as one report, not as the same line N times.
  let heading: string | undefined
  for (const check of checks) {
    const line = check.spec ? describeSpec(check.spec) : undefined
    if (line !== undefined && line !== heading) lines.push(line)
    heading = line
    lines.push(...block(check))
  }
  lines.push(
    `${count(files, 'file')} against ${checks.some((c) => c.spec) ? count(specs, 'Spec') : 'no Spec'}: ${refused} refused, ${deviating} with Deviations, ${checks.length - refused - deviating} clean.`,
  )
  return lines
}

/** The same report as data: the Spec Hash checked against, the header, and the two tiers apart. */
export const preflightJson = (checks: readonly PreflightCheck[]) => ({
  checks: checks.map((c) => c.result),
})
