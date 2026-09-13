import { HttpClient, HttpClientRequest } from '@effect/platform'
import { deviations, Deviation } from './deviation.js'
import { HEADER_BYTES, ImageHeader, inspectImageHeader } from './image-header.js'
import { UNREADABLE_HEADER, type Inspection } from './inspection.js'
import type { PrintfileReady } from './protocol.js'
import type { PrintfileSpec } from './spec.js'
import { Duration, Effect, Schema, Stream } from 'effect'

/**
 * Validation (CONTEXT.md): check a Printfile against its Spec by inspecting
 * the file's header, never decoding pixels and never downloading the whole
 * file (ADR-0002). One ranged GET, at most `HEADER_BYTES` read. Lives in the
 * contract so Pressline and the conformance suite (ticket #21) run the very
 * same code and cannot disagree.
 */

export const InvalidReason = Schema.Literal(
  'unreachable',
  'status',
  'content_type',
  'header',
  'format',
  'dimensions',
  'alpha',
  'spec_hash',
  'content_length',
  'too_large',
  'bit_depth',
  'color_type',
  'interlaced',
  'color_space',
)
export type InvalidReason = typeof InvalidReason.Type

export class PrintfileInvalid extends Schema.TaggedError<PrintfileInvalid>()('PrintfileInvalid', {
  reason: InvalidReason,
  message: Schema.String,
}) {}

const fail = (reason: InvalidReason, message: string) => new PrintfileInvalid({ reason, message })

/**
 * The one hard refusal the fulfillment provider documents and a Printfile can
 * reach. The bound is the decimal reading of Printful's "200 MB" because the
 * expensive answer is the silent one: a 213 MB file submitted as a draft was
 * accepted and its file never attached (`docs/audit/printfile-requirements.md`,
 * probed 2026-09-13).
 */
export const MAX_PRINTFILE_BYTES = 200_000_000

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/** Why an `unseen` alpha is rejected, and what the Engine developer changes. */
export const ALPHA_UNSEEN_ADVICE = `no IDAT chunk was found in the ${HEADER_BYTES / 1024} KiB Pressline reads, so whether the file has an alpha channel could not be seen; keep ancillary chunks (iCCP, eXIf, text) small enough that IDAT starts inside that window`

/**
 * Everything about a Printfile that is not in its bytes: what the host served,
 * and what the Engine announced about it. Every field is optional, because the
 * callers differ — Validation has an Engine's `PrintfileReady`, `printfile
 * check` has a bare URL, Preflight has a file on disk. A fact nobody has skips
 * the rules that need it.
 */
export interface PrintfileFacts {
  /** Named in messages, so the operator sees which file answered. */
  readonly url?: string
  readonly status?: number
  /** Content type the host served, parameters stripped. */
  readonly servedContentType?: string
  /** Total size the host reported, when it reported a usable one. */
  readonly servedBytes?: number
  readonly declaredContentType?: string
  readonly declaredBytes?: number
  readonly declaredWidth?: number
  readonly declaredHeight?: number
  /** The Spec Hash the Engine echoed, and the one Pressline computed (ADR-0005). */
  readonly declaredSpecHash?: string
  readonly expectedSpecHash?: string
}

/** `image/png` or anything else the protocol allows, as the parser names it. */
const claimedFormat = (facts: PrintfileFacts) =>
  facts.declaredContentType === undefined
    ? undefined
    : facts.declaredContentType === 'image/png'
      ? 'png'
      : 'jpeg'

/**
 * The rules that need no bytes: the Spec Hash the Engine echoed and the format
 * it announced. `checkPrintfile` runs them first, and Validation runs them
 * before it fetches, so a Printfile rendered for the wrong Spec costs no
 * request.
 */
export const checkDeclaration = (
  spec: PrintfileSpec,
  facts: PrintfileFacts = {},
): readonly PrintfileInvalid[] => {
  const problems: PrintfileInvalid[] = []
  if (
    facts.declaredSpecHash !== undefined &&
    facts.expectedSpecHash !== undefined &&
    facts.declaredSpecHash !== facts.expectedSpecHash
  ) {
    problems.push(
      fail(
        'spec_hash',
        `Engine rendered for spec ${facts.declaredSpecHash.slice(0, 12)}…, expected ${facts.expectedSpecHash.slice(0, 12)}…`,
      ),
    )
  }
  const claimed = claimedFormat(facts)
  if (claimed && !spec.formats.includes(claimed)) {
    problems.push(
      fail(
        'format',
        `${facts.declaredContentType} is not accepted for this placement (${spec.formats.join(', ')})`,
      ),
    )
  }
  return problems
}

/** The rejections a PNG's own IHDR and chunk table settle, in table order. */
const pngRefusals = (header: Extract<ImageHeader, { format: 'png' }>) => {
  const problems: PrintfileInvalid[] = []
  if (header.bitDepth !== 8) {
    problems.push(
      fail(
        'bit_depth',
        `the PNG declares a ${header.bitDepth}-bit depth; Printfiles are 8 bits per channel`,
      ),
    )
  }
  if (header.colorType === 3) {
    problems.push(
      fail(
        'color_type',
        'the PNG is palette-indexed (color type 3), so it carries at most 256 colors; write it as truecolor RGB',
      ),
    )
  }
  if (header.interlaced) {
    problems.push(
      fail(
        'interlaced',
        'the PNG is interlaced (Adam7); write it non-interlaced, so the Printfile streams in one pass',
      ),
    )
  }
  // A PNG may not carry a CMYK profile at all (PNG §11.3.3.3), and Printful
  // advises against CMYK in as many words. An `unseen` profile deviates instead:
  // `unseen` refuses only where the Spec binds the property, and nothing binds
  // the profile's identity.
  const space = header.iccProfile?.colorSpace
  if (space === 'cmyk' || space === 'gray') {
    problems.push(
      fail(
        'color_space',
        `the embedded profile "${header.iccProfile!.name}" declares a ${space === 'cmyk' ? 'CMYK' : 'grayscale'} color space; Printfiles are sRGB, and a PNG may not carry a ${space === 'cmyk' ? 'CMYK' : 'grayscale'} profile`,
      ),
    )
  }
  return problems
}

/** The rejections a JPEG's frame header and `APP14` settle, in table order. */
const jpegRefusals = (header: Extract<ImageHeader, { format: 'jpeg' }>) => {
  const problems: PrintfileInvalid[] = []
  if (header.precision !== 8) {
    problems.push(
      fail(
        'bit_depth',
        `the JPEG declares ${header.precision}-bit samples; Printfiles are 8 bits per channel`,
      ),
    )
  }
  // The frame header already proves the channels, so the APP2 ICC profile is never read.
  if (header.components === 4) {
    problems.push(
      fail('color_space', 'the JPEG has four channels, so it is CMYK or YCCK; Printfiles are sRGB'),
    )
  } else if (header.adobeTransform === 2) {
    problems.push(
      fail(
        'color_space',
        'the JPEG declares an Adobe YCCK transform, so it is CMYK; Printfiles are sRGB',
      ),
    )
  }
  return problems
}

/**
 * The verdict: **everything** Validation refuses about this file, in table
 * order, so an Engine developer fixes it all in one round. Pure, so
 * `validatePrintfile`, the operator's `printfile check` and an Engine
 * developer's Preflight cannot disagree about the same file. An empty list
 * means the file is sellable; what it merely departs from is `deviations`.
 *
 * Two refusals end the list where nothing after them would be about this file:
 * a response that is not the file (`status`), and bytes that are no image
 * (`header`).
 */
export const checkPrintfile = (
  header: ImageHeader | undefined,
  spec: PrintfileSpec,
  facts: PrintfileFacts = {},
): readonly PrintfileInvalid[] => {
  const where = facts.url ?? 'the file'
  const claimed = claimedFormat(facts)
  const problems: PrintfileInvalid[] = [...checkDeclaration(spec, facts)]
  if (facts.status !== undefined && facts.status !== 200 && facts.status !== 206) {
    return [...problems, fail('status', `${where} answered ${facts.status}`)]
  }
  if (
    facts.declaredContentType !== undefined &&
    facts.servedContentType !== undefined &&
    facts.servedContentType !== facts.declaredContentType
  ) {
    problems.push(
      fail(
        'content_type',
        `served as ${facts.servedContentType || 'unknown'}, declared ${facts.declaredContentType}`,
      ),
    )
  }
  if (
    facts.declaredBytes !== undefined &&
    facts.servedBytes !== undefined &&
    facts.servedBytes !== facts.declaredBytes
  ) {
    problems.push(
      fail(
        'content_length',
        `file is ${facts.servedBytes} bytes, Engine declared ${facts.declaredBytes}`,
      ),
    )
  }
  // Its own code, not a reuse of `content_length`: "disagrees with what the
  // Engine declared" is a different fact from "over the provider's ceiling".
  const size = Math.max(facts.servedBytes ?? 0, facts.declaredBytes ?? 0)
  if (size > MAX_PRINTFILE_BYTES) {
    problems.push(
      fail(
        'too_large',
        `the file is ${megabytes(size)}; the fulfillment provider refuses anything over ${megabytes(MAX_PRINTFILE_BYTES)}`,
      ),
    )
  }

  if (!header) return [...problems, fail('header', UNREADABLE_HEADER)]
  if (claimed === undefined) {
    if (!spec.formats.includes(header.format)) {
      problems.push(
        fail(
          'format',
          `${header.format} is not accepted for this placement (${spec.formats.join(', ')})`,
        ),
      )
    }
  } else if (header.format !== claimed) {
    problems.push(fail('format', `file is ${header.format}, declared ${facts.declaredContentType}`))
  }
  if (header.width !== spec.width || header.height !== spec.height) {
    problems.push(
      fail(
        'dimensions',
        `file is ${header.width}×${header.height}, spec requires ${spec.width}×${spec.height}`,
      ),
    )
  } else if (
    (facts.declaredWidth !== undefined && facts.declaredWidth !== header.width) ||
    (facts.declaredHeight !== undefined && facts.declaredHeight !== header.height)
  ) {
    problems.push(
      fail(
        'dimensions',
        `Engine declared ${facts.declaredWidth}×${facts.declaredHeight} but the file is ${header.width}×${header.height}`,
      ),
    )
  }
  problems.push(...(header.format === 'png' ? pngRefusals(header) : jpegRefusals(header)))
  // `unseen` is rejected on both alpha rules: the window proved nothing, and we
  // pay for a wrong print. That is the whole of the `unseen` rule — it refuses
  // only where the Spec binds the property, and `spec.alpha` binds it.
  if (spec.alpha === 'required' && header.alpha !== 'present') {
    problems.push(
      fail(
        'alpha',
        header.alpha === 'unseen'
          ? `transparency is required for this placement but ${ALPHA_UNSEEN_ADVICE}`
          : 'transparency is required for this placement but the file has no alpha channel',
      ),
    )
  }
  if (spec.alpha === 'forbidden' && header.alpha !== 'absent') {
    problems.push(
      fail(
        'alpha',
        header.alpha === 'unseen'
          ? `this placement does not accept transparency and ${ALPHA_UNSEEN_ADVICE}`
          : 'this placement does not accept transparency but the file has an alpha channel',
      ),
    )
  }
  return problems
}

/** Read at most `limit` bytes of the response body, then stop (the rest is never transferred). */
const readPrefix = (stream: Stream.Stream<Uint8Array, unknown>, limit: number) =>
  stream.pipe(
    Stream.runFoldWhile(
      new Uint8Array(0),
      (acc) => acc.length < limit,
      (acc, chunk) => {
        const take = Math.min(chunk.length, limit - acc.length)
        const next = new Uint8Array(acc.length + take)
        next.set(acc)
        next.set(chunk.subarray(0, take), acc.length)
        return next
      },
    ),
  )

/**
 * The Inspection as the operator API publishes it: the response facts, then the
 * Inspection itself — the **whole** header, every refusal and every Deviation.
 * Additive only and no version field, so an older instance simply omits a field
 * a newer client knows about; every new field is optional in the CLI's decoder.
 */
export const PrintfileInspection = Schema.Struct({
  status: Schema.Int,
  contentType: Schema.String,
  bytes: Schema.optional(Schema.Int),
  header: Schema.optional(ImageHeader),
  invalid: Schema.Array(PrintfileInvalid),
  deviations: Schema.Array(Deviation),
})
export type PrintfileInspection = typeof PrintfileInspection.Type

/**
 * The Inspection as it is stored and snapshotted: the evidence and the verdict
 * at validation time, with no refusals — a stored Printfile has none. Rules may
 * change under a record; the record does not.
 */
export const StoredInspection = Schema.Struct({
  header: Schema.optional(ImageHeader),
  deviations: Schema.Array(Deviation),
})
export type StoredInspection = typeof StoredInspection.Type

/**
 * What one ranged GET saw: the response facts, and the header parsed out of the
 * window. `checkPrintfile` turns it into a verdict, `deviations` into a list.
 */
export interface PrintfileHead {
  readonly status: number
  /** Content type the host served, parameters stripped. */
  readonly contentType: string
  readonly bytes?: number
  readonly header?: ImageHeader
}

/**
 * Read the head of a Printfile: one ranged GET, at most `HEADER_BYTES`, no
 * pixels decoded. The header is inspected, not merely parsed, so an embedded
 * profile's color space is read within the same window (ADR-0002 as amended).
 */
export const readPrintfileHead = (
  url: string,
): Effect.Effect<PrintfileHead, PrintfileInvalid, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader('Range', `bytes=0-${HEADER_BYTES - 1}`),
        ),
      )
      .pipe(
        Effect.timeout(Duration.seconds(10)),
        Effect.mapError((e) => fail('unreachable', `could not fetch ${url}: ${e.message}`)),
      )
    const total =
      response.status === 206
        ? Number(/\/(\d+)$/.exec(response.headers['content-range'] ?? '')?.[1])
        : Number(response.headers['content-length'])
    const prefix = yield* readPrefix(response.stream, HEADER_BYTES).pipe(
      Effect.mapError((e) => fail('unreachable', `could not read ${url}: ${String(e)}`)),
    )
    const header = yield* inspectImageHeader(prefix)
    return {
      status: response.status,
      contentType: (response.headers['content-type'] ?? '').split(';')[0]!.trim(),
      ...(Number.isFinite(total) && total > 0 ? { bytes: total } : {}),
      ...(header ? { header } : {}),
    }
  }).pipe(Effect.scoped)

/** What a caller has to say about the file it read, in the facts `checkPrintfile` reads. */
export const factsOf = (file: PrintfileHead, url?: string): PrintfileFacts => ({
  ...(url === undefined ? {} : { url }),
  status: file.status,
  servedContentType: file.contentType,
  ...(file.bytes === undefined ? {} : { servedBytes: file.bytes }),
})

/** Everything one look at a file concluded: the header, the refusals, the Deviations. */
export const inspect = (
  file: Pick<PrintfileHead, 'header'>,
  spec: PrintfileSpec,
  facts: PrintfileFacts,
): Inspection => ({
  ...(file.header ? { header: file.header } : {}),
  invalid: checkPrintfile(file.header, spec, facts),
  deviations: file.header ? deviations(file.header, spec) : [],
})

/**
 * Validate the Engine's answer against the Spec. `expectedSpecHash` is what
 * Pressline computed; the Engine must echo it (ADR-0005).
 *
 * **The Inspection is the return value, not the error.** A refused file comes
 * back with `invalid` filled, so a caller that wants every refusal has them and
 * a caller that wants to stop at the first one still can; the error channel is
 * for a file nobody could look at — unreachable, timed out — which is not a
 * verdict about the file.
 */
export const validatePrintfile = (
  ready: PrintfileReady,
  spec: PrintfileSpec,
  expectedSpecHash: string,
): Effect.Effect<Inspection, PrintfileInvalid, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const declaration = {
      url: ready.url,
      declaredContentType: ready.contentType,
      declaredBytes: ready.bytes,
      declaredWidth: ready.width,
      declaredHeight: ready.height,
      declaredSpecHash: ready.specHash,
      expectedSpecHash,
    } satisfies PrintfileFacts
    // The Spec Hash and the declared format are settled before a byte moves.
    const declared = checkDeclaration(spec, declaration)
    if (declared.length > 0) return { invalid: declared, deviations: [] }

    const served = yield* readPrintfileHead(ready.url)
    return inspect(served, spec, { ...declaration, ...factsOf(served) })
  }).pipe(Effect.scoped)
