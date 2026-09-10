import { specHash, type CatalogueResponse } from '@pressline/contract';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryCatalog } from '$lib/server/services/memory';
import { makeTestApp, type TestApp } from './harness';

/** Provider-side catalog the Operator's Offers point at (shapes as the adapter returns them). */
const catalog: MemoryCatalog = {
  products: [
    {
      id: 71,
      name: 'Unisex Staple T-Shirt | Bella + Canvas 3001',
      printMethods: [
        { placement: 'front', technique: 'dtg' },
        { placement: 'back', technique: 'dtg' },
      ],
    },
    {
      id: 1,
      name: 'Enhanced Matte Paper Poster (in)',
      printMethods: [{ placement: 'default', technique: 'digital' }],
    },
  ],
  variants: [
    {
      id: 4017,
      catalogProductId: 71,
      name: 'Bella + Canvas 3001 (Black / M)',
      size: 'M',
      color: 'Black',
      imageUrl: 'https://files.test/4017.jpg',
      placementDimensions: [{ placement: 'front', widthIn: 12, heightIn: 16, orientation: 'any' }],
    },
    {
      id: 1349,
      catalogProductId: 1,
      name: 'Poster 18×24',
      size: '18″×24″',
      placementDimensions: [
        { placement: 'default', widthIn: 18, heightIn: 24, orientation: 'vertical' },
      ],
    },
  ],
  printAreas: {
    71: [
      {
        placement: 'front',
        technique: 'dtg',
        printAreaWidthIn: 12,
        printAreaHeightIn: 16,
        dpi: 150,
      },
    ],
    1: [
      {
        placement: 'default',
        technique: 'digital',
        printAreaWidthIn: 18,
        printAreaHeightIn: 24,
        dpi: 150,
      },
    ],
  },
};

const offers = [
  {
    slug: 'tee-black-front',
    name: 'Black tee, front print',
    catalogProductId: 71,
    placement: 'front',
    technique: 'dtg',
    retailPrice: 2500,
    variants: { 'black-m': { catalogVariantId: 4017, label: 'Black / M' } },
  },
  {
    slug: 'poster-18x24',
    name: 'Matte poster 18×24',
    catalogProductId: 1,
    placement: 'default',
    technique: 'digital',
    retailPrice: 1900,
    aspect: { min: 0.7, max: 0.8 },
    variants: { '18x24': { catalogVariantId: 1349, label: '18×24 in' } },
  },
];

describe('GET /api/offers (public Catalogue)', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('returns Offers with Printfile Specs derived from the provider (inches × DPI)', async () => {
    app = await makeTestApp({ config: { catalogue: { offers } }, catalog });
    const { status, body } = await app.json<CatalogueResponse>('/api/offers');
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
    app = await makeTestApp({ config: { catalogue: { offers } }, catalog });
    await app.json('/api/offers');
    const after1 = await app.fulfilmentProviderCalls();
    expect(after1).toBeGreaterThan(0);
    const { status } = await app.json('/api/offers');
    expect(status).toBe(200);
    expect(await app.fulfilmentProviderCalls()).toBe(after1);
  });

  it('re-resolves from the provider once the cache TTL has expired', async () => {
    app = await makeTestApp({ config: { catalogue: { offers } }, catalog });
    await app.json('/api/offers');
    const warm = await app.fulfilmentProviderCalls();
    app.advanceClock('23 hours');
    await app.json('/api/offers');
    expect(await app.fulfilmentProviderCalls()).toBe(warm);
    app.advanceClock('2 hours');
    const { status } = await app.json('/api/offers');
    expect(status).toBe(200);
    expect(await app.fulfilmentProviderCalls()).toBeGreaterThan(warm);
  });

  it('applies config-side presentation overrides even when the variant is cached', async () => {
    app = await makeTestApp({ config: { catalogue: { offers } }, catalog });
    await app.json('/api/offers'); // warm the cache with the provider's colour "Black"
    await app.dispose();
    const overridden = {
      ...offers[0]!,
      variants: { 'black-m': { catalogVariantId: 4017, label: 'Noir / M', color: 'Noir' } },
    };
    // Same database would be ideal; a fresh app with the override shows the read-time merge.
    app = await makeTestApp({ config: { catalogue: { offers: [overridden] } }, catalog });
    const { body } = await app.json<CatalogueResponse>('/api/offers');
    expect(body.offers[0]!.variants[0]).toMatchObject({
      label: 'Noir / M',
      color: 'Noir',
      size: 'M',
    });
  });

  it('returns an empty Catalogue for a fresh instance', async () => {
    app = await makeTestApp();
    const { status, body } = await app.json<CatalogueResponse>('/api/offers');
    expect(status).toBe(200);
    expect(body.offers).toEqual([]);
  });

  it('503s naming the Offer when config disagrees with the provider', async () => {
    app = await makeTestApp({
      config: { catalogue: { offers: [{ ...offers[0]!, placement: 'sleeve' }] } },
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
        catalogue: {
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
