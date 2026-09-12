import { Effect, Either, Schema } from 'effect'

/**
 * Printfile Spec (CONTEXT.md): what a Printfile must satisfy for one Offer
 * variant and Placement. Pressline derives it from the fulfillment provider;
 * the Engine renders to it. Canonically serializable so both sides compute
 * the same Spec Hash (ADR-0005).
 */
export const PrintfileFormat = Schema.Literal('png', 'jpeg')
export type PrintfileFormat = typeof PrintfileFormat.Type

export const AlphaRule = Schema.Literal('required', 'allowed', 'forbidden')
export type AlphaRule = typeof AlphaRule.Type

export const PrintfileSpec = Schema.Struct({
  /** Pixel width of the printfile. */
  width: Schema.Int.pipe(Schema.positive()),
  /** Pixel height of the printfile. */
  height: Schema.Int.pipe(Schema.positive()),
  /** Dots per inch the provider prints at; stamped into the file's metadata. */
  dpi: Schema.Int.pipe(Schema.positive()),
  /** Accepted container formats. PNG whenever alpha is required or allowed. */
  formats: Schema.Array(PrintfileFormat).pipe(Schema.minItems(1)),
  colorSpace: Schema.Literal('srgb'),
  alpha: AlphaRule,
  /** Provider placement key, e.g. `front`, `back`, `default`. */
  placement: Schema.NonEmptyString,
  /** Provider print technique, e.g. `dtg`, `digital`, `embroidery`. */
  technique: Schema.NonEmptyString,
}).pipe(
  Schema.filter((spec) =>
    spec.alpha === 'forbidden' || spec.formats.includes('png')
      ? true
      : 'formats must include "png" when alpha is required or allowed',
  ),
)
export type PrintfileSpec = typeof PrintfileSpec.Type

/** Lowercase hex SHA-256, as produced by `specHash` and expected wherever a Spec Hash travels. */
export const SpecHash = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/))
export type SpecHash = typeof SpecHash.Type

/** The value is not a valid Printfile Spec (e.g. a non-integer dimension). */
export class InvalidPrintfileSpec extends Schema.TaggedError<InvalidPrintfileSpec>()(
  'InvalidPrintfileSpec',
  { message: Schema.String },
) {}

const validate = Schema.decodeUnknownEither(PrintfileSpec)

/**
 * Canonical JSON: keys sorted, no whitespace, `formats` sorted and
 * de-duplicated, every number an integer. Validates first, so a rounding
 * disagreement can never produce two hashes for "the same" spec.
 */
export const canonicalize = (spec: PrintfileSpec): Either.Either<string, InvalidPrintfileSpec> =>
  validate(spec).pipe(
    Either.mapLeft((e) => new InvalidPrintfileSpec({ message: e.message })),
    Either.map((valid) => {
      const ordered: Record<string, unknown> = {}
      for (const key of Object.keys(valid).sort()) {
        const value = (valid as Record<string, unknown>)[key]
        ordered[key] = key === 'formats' ? [...new Set(valid.formats)].sort() : value
      }
      return JSON.stringify(ordered)
    }),
  )

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

/** Spec Hash (CONTEXT.md): SHA-256 of the canonical form, lowercase hex. WebCrypto, so it runs on Node and Workers. */
export const specHash = (spec: PrintfileSpec): Effect.Effect<string, InvalidPrintfileSpec> =>
  Effect.flatMap(canonicalize(spec), (canonical) =>
    Effect.promise(async () =>
      hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))),
    ),
  )
