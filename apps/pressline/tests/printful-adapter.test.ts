import { readFileSync } from 'node:fs';
import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  FulfilmentProvider,
  FulfilmentProviderError,
} from '$lib/server/services/fulfilment-provider';
import { layerPrintful } from '$lib/server/services/printful';

/**
 * Seam 2: the Printful adapter against a replaying stub. Requests are matched
 * on path to `tests/fixtures/printful/*.json`; nothing touches the network.
 */
const seen: Request[] = [];
let forceStatus: number | undefined;
let hang = false;
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/printful/${name}`, import.meta.url), 'utf8'));

const stubFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  seen.push(req);
  const url = new URL(req.url);
  let key = url.pathname.replace(/^\/v2\//, '').replaceAll('/', '_');
  if (key === 'shipping-rates') {
    // Country-specific stub: XX is a destination Printful cannot ship to.
    const body = (await req.clone().json()) as { recipient?: { country_code?: string } };
    if (body.recipient?.country_code === 'XX') key = 'shipping-rates.XX';
  }
  if (hang) return new Promise<Response>(() => {});
  if (forceStatus)
    return Response.json({ code: forceStatus, result: 'forced' }, { status: forceStatus });
  if (req.headers.get('authorization') !== 'Bearer pf_test_token') {
    return Response.json({ code: 401, result: 'Unauthorized' }, { status: 401 });
  }
  try {
    return Response.json(fixture(`${key}.json`));
  } catch {
    try {
      const { status, body } = fixture(`${key}.error.json`);
      return Response.json(body, { status });
    } catch {
      return Response.json({ code: 404, result: 'Not found' }, { status: 404 });
    }
  }
};

const stubLayer = (token = 'pf_test_token') =>
  layerPrintful({ token, baseUrl: 'https://printful.test', timeout: '200 millis' }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, stubFetch)),
  );

const run = <A, E>(eff: Effect.Effect<A, E, FulfilmentProvider>, token?: string) =>
  Effect.runPromise(eff.pipe(Effect.provide(stubLayer(token))));
const fail = <A, E>(eff: Effect.Effect<A, E, FulfilmentProvider>, token?: string) =>
  Effect.runPromise(eff.pipe(Effect.flip, Effect.provide(stubLayer(token))));

describe('Printful v2 adapter', () => {
  it('reads a catalog product with its placements and sends the bearer token', async () => {
    const product = await run(Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogProduct(71)));
    expect(product).toEqual({
      id: 71,
      name: 'Unisex Staple T-Shirt | Bella + Canvas 3001',
      printMethods: [
        { placement: 'front', technique: 'dtg' },
        { placement: 'back', technique: 'dtg' },
      ],
    });
    const last = seen.at(-1)!;
    expect(new URL(last.url).pathname).toBe('/v2/catalog-products/71');
    expect(last.headers.get('authorization')).toBe('Bearer pf_test_token');
  });

  it('reads a catalog variant with print dimensions in inches', async () => {
    const variant = await run(Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogVariant(4017)));
    expect(variant).toMatchObject({
      id: 4017,
      catalogProductId: 71,
      size: 'M',
      color: 'Black',
    });
    expect(variant.placementDimensions[0]).toEqual({
      placement: 'front',
      widthIn: 12,
      heightIn: 16,
      orientation: 'any',
    });
  });

  it('reads per-placement print areas and DPI from mockup styles', async () => {
    const areas = await run(
      Effect.flatMap(FulfilmentProvider, (p) => p.getPlacementPrintAreas(71)),
    );
    expect(areas[0]).toEqual({
      placement: 'front',
      technique: 'dtg',
      printAreaWidthIn: 12,
      printAreaHeightIn: 16,
      dpi: 150,
    });
  });

  it('quotes shipping rates for a destination in minor units', async () => {
    const rates = await run(
      Effect.flatMap(FulfilmentProvider, (p) =>
        p.getShippingRates({
          countryCode: 'DE',
          items: [{ catalogVariantId: 4017, quantity: 1 }],
          currency: 'EUR',
        }),
      ),
    );
    expect(rates[0]).toEqual({
      method: 'STANDARD',
      name: 'Flat Rate',
      rate: { amount: 479, currency: 'EUR' },
      minDeliveryDays: 4,
      maxDeliveryDays: 7,
    });
    expect(rates[1]!.rate.amount).toBe(1240);
    const sent = JSON.parse(await seen.at(-1)!.clone().text()) as Record<string, unknown>;
    expect(sent).toMatchObject({
      recipient: { country_code: 'DE' },
      order_items: [{ source: 'catalog', catalog_variant_id: 4017, quantity: 1 }],
      currency: 'EUR',
    });
  });

  it('treats a 400 for an unshippable destination as "no options", not an outage', async () => {
    const rates = await run(
      Effect.flatMap(FulfilmentProvider, (p) =>
        p.getShippingRates({
          countryCode: 'XX',
          items: [{ catalogVariantId: 4017, quantity: 1 }],
          currency: 'EUR',
        }),
      ),
    );
    expect(rates).toEqual([]);
  });

  it('keeps a 400 that is not about the destination as a real error', async () => {
    forceStatus = 400;
    const err = await fail(
      Effect.flatMap(FulfilmentProvider, (p) =>
        p.getShippingRates({
          countryCode: 'DE',
          items: [{ catalogVariantId: 1, quantity: 1 }],
          currency: 'EUR',
        }),
      ),
    );
    forceStatus = undefined;
    expect(err).toMatchObject({ status: 400, retryable: false });
  });

  it('reads variant prices per technique, preferring the discounted price', async () => {
    const prices = await run(
      Effect.flatMap(FulfilmentProvider, (p) => p.getVariantPrices(4017, 'EUR')),
    );
    expect(prices).toEqual({
      currency: 'EUR',
      byTechnique: { dtg: 1090 },
      placementSurcharge: { 'front/dtg': 0, 'back/dtg': 595 },
    });
    expect(new URL(seen.at(-1)!.url).search).toBe('?currency=EUR');
  });

  it('maps 404 to a non-retryable FulfilmentProviderError carrying Printful’s message', async () => {
    const err = await fail(Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogVariant(999999)));
    expect(err).toBeInstanceOf(FulfilmentProviderError);
    expect(err).toMatchObject({ retryable: false, status: 404 });
    expect((err as FulfilmentProviderError).message).toContain('Catalog variant not found');
  });

  it('maps 401 to a non-retryable FulfilmentProviderError', async () => {
    const err = await fail(
      Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogProduct(71)),
      'wrong',
    );
    expect(err).toMatchObject({ retryable: false, status: 401 });
  });

  it('bounds a stalled request and reports it as retryable', async () => {
    hang = true;
    const err = await fail(Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogProduct(71)));
    hang = false;
    expect(err).toBeInstanceOf(FulfilmentProviderError);
    expect(err).toMatchObject({ retryable: true });
    expect((err as FulfilmentProviderError).message).toMatch(/no response within/);
  });

  it('maps 429 and 5xx to retryable FulfilmentProviderErrors', async () => {
    forceStatus = 429;
    const rate = await fail(Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogProduct(71)));
    forceStatus = 503;
    const down = await fail(Effect.flatMap(FulfilmentProvider, (p) => p.getCatalogProduct(71)));
    forceStatus = undefined;
    expect(rate).toMatchObject({ retryable: true, status: 429 });
    expect(down).toMatchObject({ retryable: true, status: 503 });
  });
});
