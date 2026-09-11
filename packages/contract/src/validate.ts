import { HttpClient, HttpClientRequest } from '@effect/platform';
import type { PrintfileReady } from './protocol.js';
import type { PrintfileSpec } from './spec.js';
import { Duration, Effect, Schema, Stream } from 'effect';

/**
 * Validation (CONTEXT.md): check a Printfile against its Spec by inspecting
 * the file's header, never decoding pixels and never downloading the whole
 * file (ADR-0002). One ranged GET, at most `HEADER_BYTES` read. Lives in the
 * contract so Pressline and the conformance suite (ticket #21) run the very
 * same code and cannot disagree.
 */
export const HEADER_BYTES = 64 * 1024;

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
);
export type InvalidReason = typeof InvalidReason.Type;

export class PrintfileInvalid extends Schema.TaggedError<PrintfileInvalid>()('PrintfileInvalid', {
  reason: InvalidReason,
  message: Schema.String,
}) {}

export interface ImageHeader {
  readonly format: 'png' | 'jpeg';
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Parse what the first bytes of a PNG or JPEG say about the image. Pure; exported for tests. */
export const parseImageHeader = (bytes: Uint8Array): ImageHeader | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    // IHDR is always first: length(4) 'IHDR'(4) width(4) height(4) depth(1) colour type(1)
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const colourType = bytes[25]!;
    let hasAlpha = colourType === 4 || colourType === 6;
    // A palette or greyscale/RGB image can still carry transparency in a tRNS chunk.
    let offset = 8;
    while (!hasAlpha && offset + 8 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (type === 'tRNS') hasAlpha = true;
      if (type === 'IDAT' || type === 'IEND') break;
      offset += 12 + length;
    }
    return { format: 'png', width, height, hasAlpha };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return {
          format: 'jpeg',
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
          hasAlpha: false,
        };
      }
      offset += 2 + length;
    }
  }
  return undefined;
};

const fail = (reason: InvalidReason, message: string) => new PrintfileInvalid({ reason, message });

/** Read at most `limit` bytes of the response body, then stop (the rest is never transferred). */
const readPrefix = (stream: Stream.Stream<Uint8Array, unknown>, limit: number) =>
  stream.pipe(
    Stream.runFoldWhile(
      new Uint8Array(0),
      (acc) => acc.length < limit,
      (acc, chunk) => {
        const take = Math.min(chunk.length, limit - acc.length);
        const next = new Uint8Array(acc.length + take);
        next.set(acc);
        next.set(chunk.subarray(0, take), acc.length);
        return next;
      },
    ),
  );

export const PrintfileInspection = Schema.Struct({
  status: Schema.Int,
  contentType: Schema.String,
  bytes: Schema.optional(Schema.Int),
  header: Schema.optional(
    Schema.Struct({
      format: Schema.Literal('png', 'jpeg'),
      width: Schema.Int,
      height: Schema.Int,
      hasAlpha: Schema.Boolean,
    }),
  ),
});
export type PrintfileInspection = typeof PrintfileInspection.Type;

/** What one ranged GET says about a file: status, served type, size, and the parsed header if any. */
export const inspectPrintfile = (
  url: string,
): Effect.Effect<PrintfileInspection, PrintfileInvalid, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader('Range', `bytes=0-${HEADER_BYTES - 1}`),
        ),
      )
      .pipe(
        Effect.timeout(Duration.seconds(10)),
        Effect.mapError((e) => fail('unreachable', `could not fetch ${url}: ${e.message}`)),
      );
    const contentType = (response.headers['content-type'] ?? '').split(';')[0]!.trim();
    const total =
      response.status === 206
        ? Number(/\/(\d+)$/.exec(response.headers['content-range'] ?? '')?.[1])
        : Number(response.headers['content-length']);
    const prefix = yield* readPrefix(response.stream, HEADER_BYTES).pipe(
      Effect.mapError((e) => fail('unreachable', `could not read ${url}: ${String(e)}`)),
    );
    const header = parseImageHeader(prefix);
    return {
      status: response.status,
      contentType,
      ...(Number.isFinite(total) && total > 0 ? { bytes: total } : {}),
      ...(header ? { header } : {}),
    };
  }).pipe(Effect.scoped);

/**
 * Validate the Engine's answer against the Spec. `expectedSpecHash` is what
 * Pressline computed; the Engine must echo it (ADR-0005).
 */
export const validatePrintfile = (
  ready: PrintfileReady,
  spec: PrintfileSpec,
  expectedSpecHash: string,
): Effect.Effect<void, PrintfileInvalid, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (ready.specHash !== expectedSpecHash) {
      return yield* fail(
        'spec_hash',
        `Engine rendered for spec ${ready.specHash.slice(0, 12)}…, expected ${expectedSpecHash.slice(0, 12)}…`,
      );
    }
    const claimedFormat = ready.contentType === 'image/png' ? 'png' : 'jpeg';
    if (!spec.formats.includes(claimedFormat)) {
      return yield* fail(
        'format',
        `${ready.contentType} is not accepted for this placement (${spec.formats.join(', ')})`,
      );
    }

    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(
        HttpClientRequest.get(ready.url).pipe(
          HttpClientRequest.setHeader('Range', `bytes=0-${HEADER_BYTES - 1}`),
        ),
      )
      .pipe(
        Effect.timeout(Duration.seconds(10)),
        Effect.mapError((e) => fail('unreachable', `could not fetch ${ready.url}: ${e.message}`)),
      );
    if (response.status !== 200 && response.status !== 206) {
      return yield* fail('status', `${ready.url} answered ${response.status}`);
    }
    const contentType = (response.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (contentType !== ready.contentType) {
      return yield* fail(
        'content_type',
        `served as ${contentType || 'unknown'}, declared ${ready.contentType}`,
      );
    }
    const total =
      response.status === 206
        ? Number(/\/(\d+)$/.exec(response.headers['content-range'] ?? '')?.[1])
        : Number(response.headers['content-length']);
    if (Number.isFinite(total) && total > 0 && total !== ready.bytes) {
      return yield* fail(
        'content_length',
        `file is ${total} bytes, Engine declared ${ready.bytes}`,
      );
    }

    const prefix = yield* readPrefix(response.stream, HEADER_BYTES).pipe(
      Effect.mapError((e) => fail('unreachable', `could not read ${ready.url}: ${String(e)}`)),
    );
    const header = parseImageHeader(prefix);
    if (!header) return yield* fail('header', 'not a readable PNG or JPEG header');
    if (header.format !== claimedFormat) {
      return yield* fail('format', `file is ${header.format}, declared ${ready.contentType}`);
    }
    if (header.width !== spec.width || header.height !== spec.height) {
      return yield* fail(
        'dimensions',
        `file is ${header.width}×${header.height}, spec requires ${spec.width}×${spec.height}`,
      );
    }
    if (header.width !== ready.width || header.height !== ready.height) {
      return yield* fail(
        'dimensions',
        `Engine declared ${ready.width}×${ready.height} but the file is ${header.width}×${header.height}`,
      );
    }
    if (spec.alpha === 'required' && !header.hasAlpha) {
      return yield* fail(
        'alpha',
        'transparency is required for this placement but the file has no alpha channel',
      );
    }
    if (spec.alpha === 'forbidden' && header.hasAlpha) {
      return yield* fail(
        'alpha',
        'this placement does not accept transparency but the file has an alpha channel',
      );
    }
  }).pipe(Effect.scoped);
