import { Either, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { AspectRange, OfferVariant } from '../src/index';

describe('protocol schemas', () => {
  it('rejects an aspect range whose min exceeds max', () => {
    const decode = Schema.decodeUnknownEither(AspectRange);
    expect(Either.isLeft(decode({ min: 2, max: 1 }))).toBe(true);
    expect(Either.isRight(decode({ min: 0.7, max: 0.8 }))).toBe(true);
    expect(Either.isRight(decode({ min: 1, max: 1 }))).toBe(true);
  });

  it('rejects a catalog variant whose specHash is not a SHA-256 hex digest', () => {
    const decode = Schema.decodeUnknownEither(OfferVariant);
    const spec = {
      width: 1800,
      height: 2400,
      dpi: 150,
      formats: ['png'],
      colorSpace: 'srgb',
      alpha: 'allowed',
      placement: 'front',
      technique: 'dtg',
    };
    expect(Either.isLeft(decode({ key: 'k', label: 'l', spec, specHash: 'nope' }))).toBe(true);
    expect(Either.isRight(decode({ key: 'k', label: 'l', spec, specHash: 'a'.repeat(64) }))).toBe(
      true,
    );
  });
});
