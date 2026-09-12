import type { DesignResponse } from '@pressline/contract'
import { afterEach, describe, expect, it } from 'vitest'
import type { Quote } from '$lib/server/quote/quote'
import { catalog, offers } from './fixtures/catalog'
import { makeTestApp, type TestApp } from './harness'

const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
}
const withdrawn: DesignResponse = { ...design, id: 'design-withdrawn', sellable: false }
const engines = {
  engines: { sample: { designs: { [design.id]: design, [withdrawn.id]: withdrawn } } },
}

const q = (app: TestApp, params: Record<string, string>) =>
  app.json<Quote & { reason?: string; message?: string }>(
    '/api/quote?' +
      new URLSearchParams({
        engine: 'sample',
        designId: design.id,
        offer: 'tee-black-front',
        variant: 'black-m',
        ...params,
      }).toString(),
  )

describe('GET /api/quote', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('locks retail + standard shipping and records the Provider Cost Estimate', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines })
    const { status, body } = await q(app, { country: 'DE' })
    expect(status).toBe(200)
    expect(body).toMatchObject({
      currency: 'EUR',
      retail: 2500,
      shipping: 479,
      total: 2979,
      country: 'DE',
      shippingMethod: { id: 'STANDARD', name: 'Flat Rate', minDeliveryDays: 4, maxDeliveryDays: 7 },
    })
    // The Operator's cost is recorded but never shown to the Customer.
    expect(body).not.toHaveProperty('providerCostEstimate')
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.expiresAt - body.createdAt).toBe(30 * 60_000)

    const again = await app.json<Quote>(`/api/quotes/${body.id}`)
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({
      id: body.id,
      total: 2979,
      specHash: body.specHash,
      shippingMethod: { minDeliveryDays: 4, maxDeliveryDays: 7 },
    })
    expect(again.body).not.toHaveProperty('providerCostEstimate')
  })

  it('applies the configured shipping markup to the Customer line only', async () => {
    app = await makeTestApp({
      config: { catalog: { offers }, shipping: { markupPercent: 10 } },
      catalog,
      engines,
    })
    const { body } = await q(app, { country: 'DE' })
    expect(body.shipping).toBe(527) // 479 × 1.1 = 526.9
  })

  it('picks the cheapest method when the provider has no STANDARD one', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines })
    const { body } = await q(app, { country: 'CH' })
    expect(body.shippingMethod.id).toBe('ECONOMY')
    expect(body.shipping).toBe(890)
  })

  it('422s with no_shipping for a country the provider cannot ship to', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines })
    const { status, body } = await q(app, { country: 'AQ' })
    expect(status).toBe(422)
    expect(body).toMatchObject({ reason: 'no_shipping' })
  })

  it('422s with state_required for US/CA/AU without a state, and quotes with one', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines })
    const missing = await q(app, { country: 'US' })
    expect(missing.status).toBe(422)
    expect(missing.body).toMatchObject({ reason: 'state_required' })
    const ok = await q(app, { country: 'US', state: 'CA' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ state: 'CA', shipping: 399 })
  })

  it('422s for a variant the design is not eligible for, and for a withdrawn design', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines })
    const wrong = await q(app, { country: 'DE', variant: 'black-xxl' })
    expect(wrong.body).toMatchObject({ reason: 'not_eligible' })
    const gone = await q(app, { country: 'DE', designId: withdrawn.id })
    expect(gone.body).toMatchObject({ reason: 'not_sellable' })
  })

  it('503s when the provider quotes in another currency than the instance sells in', async () => {
    app = await makeTestApp({
      config: { catalog: { offers }, currency: 'USD' },
      catalog,
      engines,
    })
    const { status, body } = await q(app, { country: 'DE' })
    expect(status).toBe(503)
    expect(body.message).toMatch(/EUR.*USD/)
  })

  it('rejects a malformed country code at the schema boundary', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines })
    expect(
      (await app.fetch('/api/quote?engine=sample&designId=x&offer=a&variant=b&country=Germany'))
        .status,
    ).toBe(400)
  })

  it('404s an unknown quote id', async () => {
    app = await makeTestApp()
    expect((await app.fetch('/api/quotes/nope')).status).toBe(404)
  })
})
