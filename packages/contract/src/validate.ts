import { HttpClient, HttpClientRequest } from '@effect/platform'
import { HEADER_BYTES, parseImageHeader, type ImageHeader } from './image-header.js'
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
)
export type InvalidReason = typeof InvalidReason.Type

export class PrintfileInvalid extends Schema.TaggedError<PrintfileInvalid>()('PrintfileInvalid', {
  reason: InvalidReason,
  message: Schema.String,
}) {}

const fail = (reason: InvalidReason, message: string) => new PrintfileInvalid({ reason, message })

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
): PrintfileInvalid | undefined => {
  if (
    facts.declaredSpecHash !== undefined &&
    facts.expectedSpecHash !== undefined &&
    facts.declaredSpecHash !== facts.expectedSpecHash
  ) {
    return fail(
      'spec_hash',
      `Engine rendered for spec ${facts.declaredSpecHash.slice(0, 12)}…, expected ${facts.expectedSpecHash.slice(0, 12)}…`,
    )
  }
  const claimed = claimedFormat(facts)
  if (claimed && !spec.formats.includes(claimed)) {
    return fail(
      'format',
      `${facts.declaredContentType} is not accepted for this placement (${spec.formats.join(', ')})`,
    )
  }
  return undefined
}

/**
 * The verdict: everything Validation refuses, decided from the parsed header,
 * the Spec and the facts around them. Pure, so `validatePrintfile`, the
 * operator's `printfile check` and an Engine developer's Preflight cannot
 * disagree about the same file. `undefined` means the file is sellable; what it
 * departs from is `deviations`, not a refusal.
 */
export const checkPrintfile = (
  header: ImageHeader | undefined,
  spec: PrintfileSpec,
  facts: PrintfileFacts = {},
): PrintfileInvalid | undefined => {
  const where = facts.url ?? 'the file'
  const claimed = claimedFormat(facts)
  const declared = checkDeclaration(spec, facts)
  if (declared) return declared
  if (facts.status !== undefined && facts.status !== 200 && facts.status !== 206) {
    return fail('status', `${where} answered ${facts.status}`)
  }
  if (
    facts.declaredContentType !== undefined &&
    facts.servedContentType !== undefined &&
    facts.servedContentType !== facts.declaredContentType
  ) {
    return fail(
      'content_type',
      `served as ${facts.servedContentType || 'unknown'}, declared ${facts.declaredContentType}`,
    )
  }
  if (
    facts.declaredBytes !== undefined &&
    facts.servedBytes !== undefined &&
    facts.servedBytes !== facts.declaredBytes
  ) {
    return fail(
      'content_length',
      `file is ${facts.servedBytes} bytes, Engine declared ${facts.declaredBytes}`,
    )
  }

  if (!header) return fail('header', 'not a readable PNG or JPEG header')
  if (claimed === undefined) {
    if (!spec.formats.includes(header.format)) {
      return fail(
        'format',
        `${header.format} is not accepted for this placement (${spec.formats.join(', ')})`,
      )
    }
  } else if (header.format !== claimed) {
    return fail('format', `file is ${header.format}, declared ${facts.declaredContentType}`)
  }
  if (header.width !== spec.width || header.height !== spec.height) {
    return fail(
      'dimensions',
      `file is ${header.width}×${header.height}, spec requires ${spec.width}×${spec.height}`,
    )
  }
  if (
    (facts.declaredWidth !== undefined && facts.declaredWidth !== header.width) ||
    (facts.declaredHeight !== undefined && facts.declaredHeight !== header.height)
  ) {
    return fail(
      'dimensions',
      `Engine declared ${facts.declaredWidth}×${facts.declaredHeight} but the file is ${header.width}×${header.height}`,
    )
  }
  // `unseen` is rejected on both rules: the window proved nothing, and we pay for a wrong
  // print. Whether it should widen the read or become a Deviation instead is #107's call.
  if (spec.alpha === 'required' && header.alpha !== 'present') {
    return fail(
      'alpha',
      header.alpha === 'unseen'
        ? `transparency is required for this placement but ${ALPHA_UNSEEN_ADVICE}`
        : 'transparency is required for this placement but the file has no alpha channel',
    )
  }
  if (spec.alpha === 'forbidden' && header.alpha !== 'absent') {
    return fail(
      'alpha',
      header.alpha === 'unseen'
        ? `this placement does not accept transparency and ${ALPHA_UNSEEN_ADVICE}`
        : 'this placement does not accept transparency but the file has an alpha channel',
    )
  }
  return undefined
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

export const PrintfileInspection = Schema.Struct({
  status: Schema.Int,
  contentType: Schema.String,
  bytes: Schema.optional(Schema.Int),
  header: Schema.optional(
    Schema.Struct({
      format: Schema.Literal('png', 'jpeg'),
      width: Schema.Int,
      height: Schema.Int,
      alpha: Schema.Literal('present', 'absent', 'unseen'),
    }),
  ),
})
export type PrintfileInspection = typeof PrintfileInspection.Type

/**
 * What one ranged GET saw: the response facts, and the header parsed out of the
 * window. `checkPrintfile` turns it into a verdict, `deviations` into a list.
 */
export interface InspectedPrintfile {
  readonly status: number
  /** Content type the host served, parameters stripped. */
  readonly contentType: string
  readonly bytes?: number
  readonly header?: ImageHeader
}

/** Read the head of a Printfile: one ranged GET, at most `HEADER_BYTES`, no pixels decoded. */
export const inspectPrintfile = (
  url: string,
): Effect.Effect<InspectedPrintfile, PrintfileInvalid, HttpClient.HttpClient> =>
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
    const header = parseImageHeader(prefix)
    return {
      status: response.status,
      contentType: (response.headers['content-type'] ?? '').split(';')[0]!.trim(),
      ...(Number.isFinite(total) && total > 0 ? { bytes: total } : {}),
      ...(header ? { header } : {}),
    }
  }).pipe(Effect.scoped)

/** What a caller has to say about the file it read, in the facts `checkPrintfile` reads. */
export const factsOf = (file: InspectedPrintfile, url?: string): PrintfileFacts => ({
  ...(url === undefined ? {} : { url }),
  status: file.status,
  servedContentType: file.contentType,
  ...(file.bytes === undefined ? {} : { servedBytes: file.bytes }),
})

/**
 * The four header fields the operator API publishes. What else the header holds
 * stays in-process until #112 decides how the API carries it.
 */
export const toPrintfileInspection = (file: InspectedPrintfile): PrintfileInspection => ({
  status: file.status,
  contentType: file.contentType,
  ...(file.bytes === undefined ? {} : { bytes: file.bytes }),
  ...(file.header
    ? {
        header: {
          format: file.header.format,
          width: file.header.width,
          height: file.header.height,
          alpha: file.header.alpha,
        },
      }
    : {}),
})

/**
 * Validate the Engine's answer against the Spec. `expectedSpecHash` is what
 * Pressline computed; the Engine must echo it (ADR-0005). Fetches, parses and
 * hands the verdict to `checkPrintfile`, which decides everything.
 */
export const validatePrintfile = (
  ready: PrintfileReady,
  spec: PrintfileSpec,
  expectedSpecHash: string,
): Effect.Effect<void, PrintfileInvalid, HttpClient.HttpClient> =>
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
    if (declared) return yield* declared

    const served = yield* inspectPrintfile(ready.url)
    const invalid = checkPrintfile(served.header, spec, { ...declaration, ...factsOf(served) })
    if (invalid) return yield* invalid
  }).pipe(Effect.scoped)
