import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { decodeConfig } from '$lib/server/config/schema';

describe('config validation at boot', () => {
  it('rejects an invalid config with a readable message', async () => {
    const result = await Effect.runPromise(
      Effect.either(decodeConfig({ name: '', currency: 'eur', engines: [] })),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('ConfigError');
      expect(result.left.message).toContain('pressline.config.ts is invalid');
    }
  });

  it('accepts a minimal config and defaults demo to false', async () => {
    const cfg = await Effect.runPromise(
      decodeConfig({ name: 'x', currency: 'EUR', engines: [{ slug: 'a', baseUrl: 'https://a' }] }),
    );
    expect(cfg.demo).toBe(false);
  });
});
