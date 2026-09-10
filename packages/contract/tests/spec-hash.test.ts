import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { canonicalize, InvalidPrintfileSpec, specHash, type PrintfileSpec } from '../src/index';

/**
 * Published test vectors. The hashes were computed independently with
 * `printf '%s' '<canonical>' | shasum -a 256`, so an Engine in any language
 * can check its own canonicaliser against them.
 */
const vectors: ReadonlyArray<{ spec: PrintfileSpec; canonical: string; sha256: string }> = [
  {
    spec: {
      width: 1800,
      height: 2400,
      dpi: 150,
      formats: ['png'],
      colorSpace: 'srgb',
      alpha: 'required',
      placement: 'front',
      technique: 'dtg',
    },
    canonical:
      '{"alpha":"required","colorSpace":"srgb","dpi":150,"formats":["png"],"height":2400,"placement":"front","technique":"dtg","width":1800}',
    sha256: 'aa9a5e42fa4b68ffba98d9de2ab427faffbc2a53767c49c9247a4762c95981e4',
  },
  {
    spec: {
      technique: 'digital',
      placement: 'default',
      alpha: 'forbidden',
      colorSpace: 'srgb',
      formats: ['jpeg', 'png'],
      dpi: 300,
      height: 5400,
      width: 3600,
    },
    canonical:
      '{"alpha":"forbidden","colorSpace":"srgb","dpi":300,"formats":["jpeg","png"],"height":5400,"placement":"default","technique":"digital","width":3600}',
    sha256: 'ed3c05df529ac531f5098c7ff54e03b799765ee4f43ed8820f9debf9ce52a398',
  },
];

const hash = (spec: PrintfileSpec) => Effect.runPromise(specHash(spec));

describe('Printfile Spec canonical form and Spec Hash', () => {
  it.each(vectors)('canonicalises with sorted keys and no whitespace', ({ spec, canonical }) => {
    expect(canonicalize(spec)).toEqual(Either.right(canonical));
  });

  it.each(vectors)('hashes to the published SHA-256', async ({ spec, sha256 }) => {
    expect(await hash(spec)).toBe(sha256);
  });

  it('is independent of key order and formats order', async () => {
    const a = vectors[1]!.spec;
    const b: PrintfileSpec = { ...a, formats: ['png', 'jpeg'] };
    expect(await hash(b)).toBe(vectors[1]!.sha256);
  });

  it('requires png in formats whenever alpha is required or allowed', () => {
    const base = vectors[0]!.spec;
    for (const alpha of ['required', 'allowed'] as const) {
      const bad = canonicalize({ ...base, alpha, formats: ['jpeg'] });
      expect(Either.isLeft(bad) && bad.left.message).toMatch(/must include "png"/);
      expect(Either.isRight(canonicalize({ ...base, alpha, formats: ['jpeg', 'png'] }))).toBe(true);
    }
    expect(Either.isRight(canonicalize({ ...base, alpha: 'forbidden', formats: ['jpeg'] }))).toBe(
      true,
    );
  });

  it('rejects non-integer dimensions with a typed error, so both sides cannot disagree on rounding', () => {
    const result = canonicalize({ ...vectors[0]!.spec, width: 1800.5 });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InvalidPrintfileSpec);
      expect(result.left.message).toMatch(/width/);
    }
  });
});
