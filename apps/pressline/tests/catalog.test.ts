import { specHash, type CatalogResponse } from '@pressline/contract';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './harness';

import { catalog, offers } from './fixtures/catalog';

describe('GET /api/offers (public Catalog)', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('returns Offers with Printfile Specs derived from the provider (inches × DPI)', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog });
    const { status, body } = await app.json<CatalogResponse>('/api/offers');
    expect(status).toBe(200);
    expect(body.protocolVersion).toBe('1');
    expect(body.currency).toBe('EUR');

    const tee = body.offers.find((o) => o.slug === 'tee-black-front')!;
    expect(tee.retailPrice).toEqual({ amount: 2500, currency: 'EUR' });
    expect(tee.aspect).toBeNull();
    expect(tee.variants).toHaveLength(1);
    const v = tee.variants[0]!;
    expect(v).toMatchObject({
      key: 'black-m',
      label: 'Black / M',
      color: 'Black',
      size: 'M',
      imageUrl: 'https://files.test/4017.jpg',
    });
    expect(v.spec).toEqual({
      width: 1800,
      height: 2400,
      dpi: 150,
      formats: ['png'],
      colorSpace: 'srgb',
      alpha: 'allowed',
      placement: 'front',
      technique: 'dtg',
    });
    expect(v.specHash).toBe(await Effect.runPromise(specHash(v.spec)));

    const poster = body.offers.find((o) => o.slug === 'poster-18x24')!;
    expect(poster.aspect).toEqual({ min: 0.7, max: 0.8 });
    expect(poster.variants[0]!.spec).toMatchObject({
      width: 2700,
      height: 3600,
      alpha: 'forbidden',
      formats: ['png', 'jpeg'],
    });
  });

  it('serves a cache hit without calling the provider', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog });
    await app.json('/api/offers');
    const after1 = await app.fulfillmentProviderCalls();
    expect(after1).toBeGreaterThan(0);
    const { status } = await app.json('/api/offers');
    expect(status).toBe(200);
    expect(await app.fulfillmentProviderCalls()).toBe(after1);
  });

  it('re-resolves from the provider once the cache TTL has expired', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog });
    await app.json('/api/offers');
    const warm = await app.fulfillmentProviderCalls();
    app.advanceClock('23 hours');
    await app.json('/api/offers');
    expect(await app.fulfillmentProviderCalls()).toBe(warm);
    app.advanceClock('2 hours');
    const { status } = await app.json('/api/offers');
    expect(status).toBe(200);
    expect(await app.fulfillmentProviderCalls()).toBeGreaterThan(warm);
  });

  it('applies config-side presentation overrides even when the variant is cached', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog });
    await app.json('/api/offers'); // warm the cache with the provider's color "Black"
    await app.dispose();
    const overridden = {
      ...offers[0]!,
      variants: { 'black-m': { catalogVariantId: 4017, label: 'Noir / M', color: 'Noir' } },
    };
    // Same database would be ideal; a fresh app with the override shows the read-time merge.
    app = await makeTestApp({ config: { catalog: { offers: [overridden] } }, catalog });
    const { body } = await app.json<CatalogResponse>('/api/offers');
    expect(body.offers[0]!.variants[0]).toMatchObject({
      label: 'Noir / M',
      color: 'Noir',
      size: 'M',
    });
  });

  it('returns an empty Catalog for a fresh instance', async () => {
    app = await makeTestApp();
    const { status, body } = await app.json<CatalogResponse>('/api/offers');
    expect(status).toBe(200);
    expect(body.offers).toEqual([]);
  });

  it('503s naming the Offer when config disagrees with the provider', async () => {
    app = await makeTestApp({
      config: { catalog: { offers: [{ ...offers[0]!, placement: 'sleeve' }] } },
      catalog,
    });
    const { status, body } = await app.json<{ message: string }>('/api/offers');
    expect(status).toBe(503);
    expect(body.message).toMatch(/Offer "tee-black-front"/);
    expect(body.message).toMatch(/sleeve/);
  });

  it('503s naming the Offer when a variant belongs to another product', async () => {
    app = await makeTestApp({
      config: {
        catalog: {
          offers: [{ ...offers[0]!, variants: { poster: { catalogVariantId: 1349, label: 'x' } } }],
        },
      },
      catalog,
    });
    const { status, body } = await app.json<{ message: string }>('/api/offers');
    expect(status).toBe(503);
    expect(body.message).toMatch(/belongs to product 1, not 71/);
  });
});
