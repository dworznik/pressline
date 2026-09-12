import type { DesignResponse } from '@pressline/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { listOrders, listTransitions } from '$lib/server/orders/orders'
import type { PublicOrder } from '$lib/server/orders/public'
import type { Quote } from '$lib/server/quote/quote'
import { catalog, offers } from './fixtures/catalog'
import { png } from './fixtures/images'
import { makeTestApp, type TestApp } from './harness'

const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
}
const URL_OK = 'https://engine.test/files/heron/front.png'

const boot = () =>
  makeTestApp({
    config: { catalog: { offers } },
    catalog,
    engines: {
      engines: {
        sample: {
          designs: { [design.id]: design },
          printfiles: { [design.id]: { kind: 'ready', url: URL_OK, bytes: 5000 } },
        },
      },
    },
    files: {
      [URL_OK]: {
        bytes: png({ width: 1800, height: 2400, totalBytes: 5000 }),
        contentType: 'image/png',
      },
    },
  })

const quote = (app: TestApp) =>
  app.json<Quote>(
    '/api/quote?engine=sample&designId=design-portrait-1&offer=tee-black-front&variant=black-m&country=DE',
  )
const ensure = (app: TestApp) =>
  app.fetch(`/api/designs/sample/${design.id}/printfile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'tee-black-front', variant: 'black-m' }),
  })
const checkout = (app: TestApp, quoteId: string) =>
  app.json<{ orderId: string; url: string; reason?: string; message?: string }>('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId }),
  })

describe('POST /api/checkout', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('quote → printfile → checkout: creates the Order in checkout_open and sends the Customer to the PSP', async () => {
    app = await boot()
    const { body: q } = await quote(app)
    expect((await ensure(app)).status).toBe(200)
    const { status, body } = await checkout(app, q.id)
    expect(status).toBe(200)
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//)
    expect(body.orderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    const [s] = await app.pspSessions()
    expect(s!.input).toMatchObject({
      orderId: body.orderId,
      currency: 'EUR',
      product: {
        name: 'Black tee, front print · Black / M',
        amount: 2500,
        imageUrl: design.previewUrl,
      },
      shipping: { name: 'Flat Rate', amount: 479, minDeliveryDays: 4, maxDeliveryDays: 7 },
      allowedCountry: 'DE',
      allowPromotionCodes: false,
    })
    expect(s!.input.consentText).toMatch(/right of withdrawal/)
    expect(s!.input.successUrl).toMatch(
      new RegExp(`^http://pressline\\.test/orders/${body.orderId}/thank-you\\?t=`),
    )
    expect(s!.input.cancelUrl).toBe(`http://pressline.test/order/sample/${design.id}?canceled=1`)
    expect(s!.input.expiresAt * 1000 - Date.now()).toBeGreaterThan(59 * 60_000)

    const token = new URL(s!.input.successUrl).searchParams.get('t')!
    const order = await app.json<PublicOrder>(`/api/orders/${body.orderId}?t=${token}`)
    expect(order.status).toBe(200)
    expect(order.body).toMatchObject({
      id: body.orderId,
      state: 'checkout_open',
      offer: 'tee-black-front',
      retail: 2500,
      shipping: 479,
    })
    expect(order.body).not.toHaveProperty('recipient')

    const transitions = await app.run(listTransitions(body.orderId))
    expect(
      transitions._tag === 'Success' && transitions.value.map((t) => [t.from, t.to, t.cause]),
    ).toEqual([[null, 'checkout_open', 'storefront']])
  })

  it('refuses checkout without a validated Printfile (ADR-0004)', async () => {
    app = await boot()
    const { body: q } = await quote(app)
    const { status, body } = await checkout(app, q.id)
    expect(status).toBe(422)
    expect(body).toMatchObject({ reason: 'printfile_missing' })
    expect(await app.pspSessions()).toHaveLength(0)
  })

  it('refuses an expired Quote', async () => {
    app = await boot()
    const { body: q } = await quote(app)
    await ensure(app)
    app.advanceClock('31 minutes')
    const { status, body } = await checkout(app, q.id)
    expect(status).toBe(422)
    expect(body).toMatchObject({ reason: 'quote_expired' })
  })

  it('404s an unknown Quote and a wrong status token', async () => {
    app = await boot()
    expect((await checkout(app, 'nope')).status).toBe(404)
    const { body: q } = await quote(app)
    await ensure(app)
    const { body } = await checkout(app, q.id)
    expect((await app.fetch(`/api/orders/${body.orderId}?t=wrong`)).status).toBe(404)
  })

  it('502s when the PSP is down and expires the Order it had opened', async () => {
    app = await boot()
    const { body: q } = await quote(app)
    await ensure(app)
    app.pspDown(true)
    const { status } = await checkout(app, q.id)
    expect(status).toBe(502)
    expect(await app.pspSessions()).toHaveLength(0)
    const orders = await app.run(listOrders())
    expect(
      orders._tag === 'Success' && orders.value.map((o) => [o.state, o.psp.sessionId]),
    ).toEqual([['expired', undefined]])
  })
})
