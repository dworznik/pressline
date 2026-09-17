import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { FetchHttpClient } from '@effect/platform'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  FulfillmentProvider,
  FulfillmentProviderError,
} from '$lib/server/services/fulfillment-provider'
import { layerPrintful } from '$lib/server/services/printful'

/**
 * Seam 2: the Printful adapter against a replaying stub. Requests are matched
 * on path to `tests/fixtures/printful/*.json`; nothing touches the network.
 */
const seen: Request[] = []
let forceStatus: number | undefined
let forceHeaders: Record<string, string> | undefined
let hang = false
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/printful/${name}`, import.meta.url), 'utf8'))

const stubFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init)
  seen.push(req)
  const url = new URL(req.url)
  // v2 paths are `/v2/orders/…`; the cancel route is v1's `/orders/…` (see the adapter).
  let key = url.pathname.replace(/^\/(?:v2\/)?/, '').replaceAll('/', '_')
  if (key === 'shipping-rates') {
    // Country-specific stub: XX is a destination Printful cannot ship to.
    const body = (await req.clone().json()) as { recipient?: { country_code?: string } }
    if (body.recipient?.country_code === 'XX') key = 'shipping-rates.XX'
  }
  if (hang) return new Promise<Response>(() => {})
  if (forceStatus)
    return Response.json(
      { code: forceStatus, result: 'forced' },
      { status: forceStatus, ...(forceHeaders ? { headers: forceHeaders } : {}) },
    )
  if (req.headers.get('authorization') !== 'Bearer pf_test_token') {
    return Response.json({ code: 401, result: 'Unauthorized' }, { status: 401 })
  }
  // A method-specific fixture (`orders_123.patch.json`) wins over the shared one.
  const method = req.method.toLowerCase()
  const candidates = method === 'get' ? [key] : [`${key}.${method}`, key]
  for (const c of candidates) {
    try {
      return Response.json(fixture(`${c}.json`))
    } catch {
      /* next */
    }
    try {
      const { status, body } = fixture(`${c}.error.json`)
      return Response.json(body, { status })
    } catch {
      /* next */
    }
  }
  return Response.json({ code: 404, result: 'Not found' }, { status: 404 })
}

const FIXTURE_HMAC_KEY = '0123456789abcdef'.repeat(4) // low-entropy on purpose: a fixture, not a secret
const stubLayer = (token = 'pf_test_token') =>
  layerPrintful({
    token,
    baseUrl: 'https://printful.test',
    timeout: '200 millis',
    webhookSecret: FIXTURE_HMAC_KEY,
    webhookPublicKey: 'SbF/9d/uWguI',
  }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, stubFetch)),
  )

const run = <A, E>(eff: Effect.Effect<A, E, FulfillmentProvider>, token?: string) =>
  Effect.runPromise(eff.pipe(Effect.provide(stubLayer(token))))
const fail = <A, E>(eff: Effect.Effect<A, E, FulfillmentProvider>, token?: string) =>
  Effect.runPromise(eff.pipe(Effect.flip, Effect.provide(stubLayer(token))))

describe('Printful v2 adapter', () => {
  it('reads a catalog product with its placements and sends the bearer token', async () => {
    const product = await run(Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogProduct(71)))
    expect(product).toEqual({
      id: 71,
      name: 'Unisex Staple T-Shirt | Bella + Canvas 3001',
      printMethods: [
        { placement: 'front', technique: 'dtg' },
        { placement: 'back', technique: 'dtg' },
      ],
    })
    const last = seen.at(-1)!
    expect(new URL(last.url).pathname).toBe('/v2/catalog-products/71')
    expect(last.headers.get('authorization')).toBe('Bearer pf_test_token')
  })

  it('reads a catalog variant with print dimensions in inches', async () => {
    const variant = await run(Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogVariant(4017)))
    expect(variant).toMatchObject({
      id: 4017,
      catalogProductId: 71,
      size: 'M',
      color: 'Black',
    })
    expect(variant.placementDimensions[0]).toEqual({
      placement: 'front',
      widthIn: 12,
      heightIn: 16,
      orientation: 'any',
    })
  })

  it('reads per-placement print areas and DPI from mockup styles', async () => {
    const areas = await run(
      Effect.flatMap(FulfillmentProvider, (p) => p.getPlacementPrintAreas(71)),
    )
    expect(areas[0]).toEqual({
      placement: 'front',
      technique: 'dtg',
      printAreaWidthIn: 12,
      printAreaHeightIn: 16,
      dpi: 150,
    })
  })

  it('quotes shipping rates for a destination in minor units', async () => {
    const rates = await run(
      Effect.flatMap(FulfillmentProvider, (p) =>
        p.getShippingRates({
          countryCode: 'DE',
          items: [{ catalogVariantId: 4017, quantity: 1 }],
          currency: 'EUR',
        }),
      ),
    )
    expect(rates[0]).toEqual({
      method: 'STANDARD',
      name: 'Flat Rate',
      rate: { amount: 479, currency: 'EUR' },
      minDeliveryDays: 4,
      maxDeliveryDays: 7,
    })
    expect(rates[1]!.rate.amount).toBe(1240)
    const sent = JSON.parse(await seen.at(-1)!.clone().text()) as Record<string, unknown>
    expect(sent).toMatchObject({
      recipient: { country_code: 'DE' },
      order_items: [{ source: 'catalog', catalog_variant_id: 4017, quantity: 1 }],
      currency: 'EUR',
    })
  })

  it('treats a 400 for an unshippable destination as "no options", not an outage', async () => {
    const rates = await run(
      Effect.flatMap(FulfillmentProvider, (p) =>
        p.getShippingRates({
          countryCode: 'XX',
          items: [{ catalogVariantId: 4017, quantity: 1 }],
          currency: 'EUR',
        }),
      ),
    )
    expect(rates).toEqual([])
  })

  it('keeps a 400 that is not about the destination as a real error', async () => {
    forceStatus = 400
    const err = await fail(
      Effect.flatMap(FulfillmentProvider, (p) =>
        p.getShippingRates({
          countryCode: 'DE',
          items: [{ catalogVariantId: 1, quantity: 1 }],
          currency: 'EUR',
        }),
      ),
    )
    forceStatus = undefined
    expect(err).toMatchObject({ status: 400, retryable: false })
  })

  it('reads variant prices per technique, preferring the discounted price', async () => {
    const prices = await run(
      Effect.flatMap(FulfillmentProvider, (p) => p.getVariantPrices(4017, 'EUR')),
    )
    expect(prices).toEqual({
      currency: 'EUR',
      byTechnique: { dtg: 1090 },
      placementSurcharge: { 'front/dtg': 0, 'back/dtg': 595 },
    })
    expect(new URL(seen.at(-1)!.url).search).toBe('?currency=EUR')
  })

  describe('orders', () => {
    it('finds an order by external id, and answers undefined (not an error) when there is none', async () => {
      const found = await run(
        Effect.flatMap(FulfillmentProvider, (p) =>
          p.findOrderByExternalId('0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'),
        ),
      )
      expect(found).toMatchObject({
        id: '123',
        externalId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        status: 'draft',
        recipient: { countryCode: 'DE' },
      })
      expect(found!.items[0]).toEqual({ catalogVariantId: 4017, quantity: 1 })
      expect(found!.costs).toEqual({
        currency: 'EUR',
        subtotal: 1090,
        shipping: 479,
        tax: 298,
        total: 1867,
        calculating: false,
      })
      expect(new URL(seen.at(-1)!.url).pathname).toBe(
        '/v2/orders/@0192a1b2c3d47e5f8a9b0c1d2e3f4a5b',
      )
      expect(
        await run(
          Effect.flatMap(FulfillmentProvider, (p) => p.findOrderByExternalId('unknown-order-id')),
        ),
      ).toBeUndefined()
    })

    it('encodes a later attempt inside the 32-character external id, reversibly (#77)', async () => {
      const orderId = '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
      // Attempt 0 is the plain Order ID without hyphens: unchanged, so Orders
      // created before #77 still resolve.
      await run(Effect.flatMap(FulfillmentProvider, (p) => p.findOrderByExternalId(orderId)))
      expect(new URL(seen.at(-1)!.url).pathname).toBe(
        '/v2/orders/@0192a1b2c3d47e5f8a9b0c1d2e3f4a5b',
      )

      // A later attempt cannot reuse it: Printful never releases an external id.
      await run(Effect.flatMap(FulfillmentProvider, (p) => p.findOrderByExternalId(orderId, 2)))
      const attempted = decodeURIComponent(
        new URL(seen.at(-1)!.url).pathname.replace('/v2/orders/@', ''),
      )
      expect(attempted).not.toBe('0192a1b2c3d47e5f8a9b0c1d2e3f4a5b')
      expect(attempted.length).toBeLessThanOrEqual(32)
      expect(attempted).toMatch(/^[A-Za-z0-9_-]+$/) // Printful's charset
      expect(attempted).toMatch(/-2$/)

      // And it reverses: a webhook carrying that id resolves to the same Order.
      const body = JSON.stringify({
        type: 'order_updated',
        occurred_at: '2026-09-12T09:15:05Z',
        retries: 0,
        store_id: 10,
        data: { order: { id: 123, external_id: attempted, status: 'pending' } },
      })
      const exit = await Effect.runPromiseExit(
        Effect.flatMap(FulfillmentProvider, (p) =>
          p.verifyWebhook(body, {
            signature: createHmac('sha256', Buffer.from(FIXTURE_HMAC_KEY, 'hex'))
              .update(body)
              .digest('hex'),
            publicKey: 'SbF/9d/uWguI',
          }),
        ).pipe(Effect.provide(stubLayer())),
      )
      expect(exit._tag).toBe('Success')
      if (exit._tag === 'Success') expect(exit.value.orderExternalId).toBe(orderId)
    })

    it('creates a draft with the recipient, the catalog variant and the Printfile on the placement', async () => {
      const draft = await run(
        Effect.flatMap(FulfillmentProvider, (p) =>
          p.createOrderDraft({
            externalId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
            shippingMethod: 'STANDARD',
            recipient: {
              name: 'Anna Example',
              address1: 'Torstraße 1',
              address2: 'Hinterhaus',
              city: 'Berlin',
              countryCode: 'DE',
              zip: '10119',
              email: 'anna@example.com',
              phone: '+4915112345678',
            },
            item: {
              catalogVariantId: 4017,
              placement: 'front',
              technique: 'dtg',
              printfileUrl: 'https://engine.test/files/heron/front.png',
              retailPrice: '25.00',
            },
            currency: 'EUR',
          }),
        ),
      )
      expect(draft).toMatchObject({ id: '123', status: 'draft' })
      const sent = JSON.parse(await seen.at(-1)!.clone().text()) as Record<string, unknown>
      expect(sent).toMatchObject({
        external_id: '0192a1b2c3d47e5f8a9b0c1d2e3f4a5b', // 32 chars on the wire: Printful's limit
        shipping: 'STANDARD',
        recipient: {
          name: 'Anna Example',
          address1: 'Torstraße 1',
          city: 'Berlin',
          country_code: 'DE',
          zip: '10119',
          email: 'anna@example.com',
        },
        order_items: [
          {
            source: 'catalog',
            catalog_variant_id: 4017,
            quantity: 1,
            retail_price: '25.00',
            placements: [
              {
                placement: 'front',
                technique: 'dtg',
                layers: [{ type: 'file', url: 'https://engine.test/files/heron/front.png' }],
              },
            ],
          },
        ],
        retail_costs: { currency: 'EUR' },
      })
    })

    it('reads a fresh draft whose costs are still calculating (every money field null) as "no costs yet"', async () => {
      const fresh = await run(Effect.flatMap(FulfillmentProvider, (p) => p.getOrder('125')))
      expect(fresh).toMatchObject({ id: '125', status: 'draft' })
      expect(fresh.costs).toBeUndefined()
    })

    it('confirms a draft and surfaces a failed placement with its explanation', async () => {
      const confirmed = await run(Effect.flatMap(FulfillmentProvider, (p) => p.confirmOrder('123')))
      expect(confirmed.status).toBe('pending')
      expect(new URL(seen.at(-1)!.url).pathname).toBe('/v2/orders/123/confirmation')
      const bad = await run(Effect.flatMap(FulfillmentProvider, (p) => p.getOrder('124')))
      expect(bad.items[0]!.failedPlacement).toMatch(/^front: Product with ID: 71/)
    })
  })

  it('lists shipments with carrier and tracking', async () => {
    const shipments = await run(Effect.flatMap(FulfillmentProvider, (p) => p.listShipments('123')))
    expect(shipments).toEqual([
      {
        id: '1',
        status: 'shipped',
        carrier: 'DHL',
        service: 'DHL Paket',
        trackingNumber: '00340434161234567890',
        trackingUrl:
          'https://www.dhl.com/de-en/home/tracking/tracking-parcel.html?tracking-id=00340434161234567890',
        shippedAt: '2026-09-12T09:15:00Z',
      },
    ])
  })

  describe('webhook verification', () => {
    const body = JSON.stringify({
      type: 'shipment_sent',
      occurred_at: '2026-09-12T09:15:05Z',
      retries: 0,
      store_id: 10,
      data: {
        order: { id: 123, external_id: '0192a1b2c3d47e5f8a9b0c1d2e3f4a5b', status: 'partial' },
        shipment: { id: 1, status: 'shipped' },
      },
    })
    const sign = (secretHex: string) =>
      createHmac('sha256', Buffer.from(secretHex, 'hex')).update(body).digest('hex')
    const verify = (signature: string | undefined, publicKey = 'SbF/9d/uWguI') =>
      Effect.runPromiseExit(
        Effect.flatMap(FulfillmentProvider, (p) =>
          p.verifyWebhook(body, { ...(signature ? { signature } : {}), publicKey }),
        ).pipe(Effect.provide(stubLayer())),
      )

    it('accepts HMAC-SHA256 over the raw body with the hex-decoded secret and reduces the event', async () => {
      const exit = await verify(sign(FIXTURE_HMAC_KEY))
      expect(exit._tag).toBe('Success')
      if (exit._tag === 'Success') {
        expect(exit.value).toMatchObject({
          type: 'shipment_sent',
          occurredAt: Math.floor(Date.parse('2026-09-12T09:15:05Z') / 1000),
          providerOrderId: '123',
          orderExternalId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
          shipmentId: '1',
        })
        expect(exit.value.id).toMatch(/^[0-9a-f]{32}$/)
        // A retry of the same event derives the same id.
        const again = await verify(sign(FIXTURE_HMAC_KEY))
        expect(again._tag === 'Success' && again.value.id).toBe(exit.value.id)
      }
    })

    it('rejects a wrong secret, a missing signature and another configuration’s public key', async () => {
      expect((await verify(sign('00'.repeat(32))))._tag).toBe('Failure')
      expect((await verify(undefined))._tag).toBe('Failure')
      expect((await verify(sign(FIXTURE_HMAC_KEY), 'other-config'))._tag).toBe('Failure')
    })
  })

  it('maps 404 to a non-retryable FulfillmentProviderError carrying Printful’s message', async () => {
    const err = await fail(Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogVariant(999999)))
    expect(err).toBeInstanceOf(FulfillmentProviderError)
    expect(err).toMatchObject({ retryable: false, status: 404 })
    expect((err as FulfillmentProviderError).message).toContain('Catalog variant not found')
  })

  it('maps 401 to a non-retryable FulfillmentProviderError', async () => {
    const err = await fail(
      Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogProduct(71)),
      'wrong',
    )
    expect(err).toMatchObject({ retryable: false, status: 401 })
  })

  it('bounds a stalled request and reports it as retryable', async () => {
    hang = true
    const err = await fail(Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogProduct(71)))
    hang = false
    expect(err).toBeInstanceOf(FulfillmentProviderError)
    expect(err).toMatchObject({ retryable: true })
    expect((err as FulfillmentProviderError).message).toMatch(/no response within/)
  })

  it('maps 429 and 5xx to retryable FulfillmentProviderErrors', async () => {
    forceStatus = 429
    const rate = await fail(Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogProduct(71)))
    forceStatus = 503
    const down = await fail(Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogProduct(71)))
    forceStatus = undefined
    expect(rate).toMatchObject({ retryable: true, status: 429 })
    expect(down).toMatchObject({ retryable: true, status: 503 })
  })

  it('carries the wait a 429 names, in seconds or as an HTTP date', async () => {
    // Printful's limiter locks the store out for a minute; retrying on our own
    // 100 ms backoff burns the whole attempt for a condition that would have
    // cleared had we waited the time the provider named (#98).
    const get = Effect.flatMap(FulfillmentProvider, (p) => p.getCatalogProduct(71))
    forceStatus = 429
    forceHeaders = { 'retry-after': '60' }
    const seconds = (await fail(get)) as FulfillmentProviderError
    forceHeaders = { 'retry-after': new Date(Date.now() + 120_000).toUTCString() }
    const httpDate = (await fail(get)) as FulfillmentProviderError
    forceHeaders = { 'retry-after': 'soon' }
    const nonsense = (await fail(get)) as FulfillmentProviderError
    forceHeaders = undefined
    const silent = (await fail(get)) as FulfillmentProviderError
    forceStatus = undefined

    expect(seconds).toMatchObject({ retryable: true, status: 429, retryAfterMs: 60_000 })
    expect(httpDate.retryAfterMs).toBeGreaterThan(110_000)
    expect(httpDate.retryAfterMs).toBeLessThanOrEqual(120_000)
    // Unreadable or absent: no wait is named, and our own backoff decides.
    expect(nonsense.retryAfterMs).toBeUndefined()
    expect(silent.retryAfterMs).toBeUndefined()
  })
})

describe('Printful adapter: operator tools (tickets #16, #17)', () => {
  it('lists catalog products and a product’s variants', async () => {
    const products = await run(Effect.flatMap(FulfillmentProvider, (p) => p.listCatalogProducts()))
    expect(products.map((p) => p.id)).toEqual([71, 1])
    const variants = await run(
      Effect.flatMap(FulfillmentProvider, (p) => p.listCatalogVariants(71)),
    )
    expect(variants.map((v) => v.id)).toEqual([4017])
    expect(variants[0]?.placementDimensions[0]).toMatchObject({ placement: 'front', widthIn: 12 })
  })

  it('registers the webhook configuration when it points elsewhere, and reports the once-shown keys', async () => {
    const created = await run(
      Effect.flatMap(FulfillmentProvider, (p) =>
        p.registerWebhook('https://shop.example/webhooks/printful'),
      ),
    )
    expect(created).toEqual({
      status: 'created',
      url: 'https://shop.example/webhooks/printful',
      secret: '0123456789abcdef0123456789abcdef',
      publicKey: 'SbF/9d/uWguI',
    })
    const posted = seen.find((r) => r.method === 'POST' && r.url.endsWith('/v2/webhooks'))
    const body = (await posted!.clone().json()) as {
      default_url: string
      events: { type: string }[]
    }
    expect(body.default_url).toBe('https://shop.example/webhooks/printful')
    expect(body.events.map((e) => e.type)).toContain('shipment_sent')
  })

  it('updates a draft’s recipient and tells cancelable from not', async () => {
    const updated = await run(
      Effect.flatMap(FulfillmentProvider, (p) =>
        p.updateOrderRecipient('124', {
          name: 'Anna Example',
          address1: 'Torstraße 2',
          city: 'Berlin',
          countryCode: 'DE',
          email: 'anna@example.com',
        }),
      ),
    )
    expect(updated.id).toBe('124')
    expect(await run(Effect.flatMap(FulfillmentProvider, (p) => p.cancelOrder('124')))).toBe(
      'canceled',
    )
    expect(await run(Effect.flatMap(FulfillmentProvider, (p) => p.cancelOrder('123')))).toBe(
      'not_cancelable',
    )
    // Deliberately v1: v2's DELETE archives rather than cancels, which hides the
    // order from v2 while its external_id stays taken (#77, #97).
    expect(new URL(seen.at(-1)!.url).pathname).toBe('/orders/123')
    expect(seen.at(-1)!.method).toBe('DELETE')
  })
})
