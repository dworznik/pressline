import { Schema } from 'effect';

/**
 * Printfile Spec (CONTEXT.md): what a Printfile must satisfy for one Offer
 * variant and Placement. Pressline derives it from the fulfilment provider;
 * the Engine renders to it. Canonically serialisable so both sides compute
 * the same Spec Hash (ADR-0005).
 */
export const PrintfileFormat = Schema.Literal('png', 'jpeg');
export type PrintfileFormat = typeof PrintfileFormat.Type;

export const AlphaRule = Schema.Literal('required', 'allowed', 'forbidden');
export type AlphaRule = typeof AlphaRule.Type;

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
});
export type PrintfileSpec = typeof PrintfileSpec.Type;

const sortedUnique = (xs: ReadonlyArray<string>) => [...new Set(xs)].sort();

/**
 * Canonical JSON: keys sorted, no whitespace, `formats` sorted and
 * de-duplicated, every number an integer. Throws on a non-integer so a
 * rounding disagreement can never produce two hashes for "the same" spec.
 */
export const canonicalize = (spec: PrintfileSpec): string => {
  for (const [k, v] of Object.entries(spec)) {
    if (typeof v === 'number' && !Number.isInteger(v)) {
      throw new TypeError(`PrintfileSpec.${k} must be an integer, got ${v}`);
    }
  }
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(spec).sort()) {
    const value = (spec as Record<string, unknown>)[key];
    ordered[key] = key === 'formats' ? sortedUnique(value as ReadonlyArray<string>) : value;
  }
  return JSON.stringify(ordered);
};

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** Spec Hash (CONTEXT.md): SHA-256 of the canonical form, lowercase hex. WebCrypto, so it runs on Node and Workers. */
export const specHash = async (spec: PrintfileSpec): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(spec))));
