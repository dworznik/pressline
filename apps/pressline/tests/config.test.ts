import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { decodeConfig } from '$lib/server/config/schema'

const valid = {
  name: 'x',
  currency: 'EUR',
  engines: [{ slug: 'a', baseUrl: 'https://a' }],
  catalog: {
    offers: [
      {
        slug: 'tee-black-front',
        name: 'Black tee, front print',
        catalogProductId: 71,
        placement: 'front',
        technique: 'dtg',
        retailPrice: 2500,
        variants: { 'black-m': { catalogVariantId: 4017, label: 'Black / M' } },
      },
    ],
  },
}

const decode = (raw: unknown) => Effect.runPromise(Effect.either(decodeConfig(raw)))

describe('config validation at boot', () => {
  it('rejects an invalid config with a readable message', async () => {
    const result = await decode({ name: '', currency: 'eur', engines: [] })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('ConfigError')
      expect(result.left.message).toContain('pressline.config.ts is invalid')
    }
  })

  it('accepts a minimal config and defaults demo and catalog', async () => {
    const cfg = await Effect.runPromise(
      decodeConfig({ name: 'x', currency: 'EUR', engines: [{ slug: 'a', baseUrl: 'https://a' }] }),
    )
    expect(cfg.demo).toBe(false)
    expect(cfg.catalog.offers).toEqual([])
  })

  it('accepts a Catalog with one Offer', async () => {
    const cfg = await Effect.runPromise(decodeConfig(valid))
    expect(cfg.catalog.offers[0]?.variants['black-m']?.catalogVariantId).toBe(4017)
  })

  it('names the offending Offer when a variant is invalid', async () => {
    const bad = structuredClone(valid)
    ;(bad.catalog.offers[0]!.variants as Record<string, unknown>)['black-m'] = {
      catalogVariantId: -1,
      label: 'Black / M',
    }
    const result = await decode(bad)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.message).toMatch(/Offer "tee-black-front"/)
      expect(result.left.message).toMatch(/catalogVariantId/)
    }
  })

  it('rejects duplicate Offer slugs', async () => {
    const bad = structuredClone(valid)
    bad.catalog.offers.push(structuredClone(valid.catalog.offers[0]!))
    const result = await decode(bad)
    expect(Either.isLeft(result) && result.left.message).toMatch(
      /duplicate Offer slug "tee-black-front"/,
    )
  })

  it('rejects an Offer without variants', async () => {
    const bad = structuredClone(valid)
    ;(bad.catalog.offers[0] as { variants: unknown }).variants = {}
    const result = await decode(bad)
    expect(Either.isLeft(result) && result.left.message).toMatch(/at least one variant/)
  })
})
