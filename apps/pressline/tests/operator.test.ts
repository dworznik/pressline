import type { DesignResponse } from '@pressline/contract'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { Db } from '$lib/server/db/db'
import type { InstanceHealth, OrderDetail, OrderList } from '$lib/server/operator/read'
import type { Quote } from '$lib/server/quote/quote'
import { catalog, offers } from './fixtures/catalog'
import { png } from './fixtures/images'
import { makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness'

type Health = typeof InstanceHealth.Type
type Detail = typeof OrderDetail.Type
type List = typeof OrderList.Type

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
const bearer = { authorization: `Bearer ${OPERATOR_TOKEN}` }
const paidSession = {
  status: 'complete' as const,
  paymentStatus: 'paid' as const,
  paymentIntentId: 'pi_3Test123',
  amountTotal: 3479,
  amountTax: 500,
  consentAccepted: true,
  customer: { email: 'anna@example.com', name: 'Anna Example', phone: '+4915112345678' },
  shipping: {
    name: 'Anna Example',
    address1: 'Torstraße 1',
    city: 'Berlin',
    zip: '10119',
    country: 'DE',
  },
}
let eventSeq = 0
const placeAndPay = async (app: TestApp) => {
  const { body: q } = await app.json<Quote>(
    '/api/quote?engine=sample&designId=design-portrait-1&offer=tee-black-front&variant=black-m&country=DE',
  )
  await app.fetch(`/api/designs/sample/${design.id}/printfile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'tee-black-front', variant: 'black-m' }),
  })
  const { body } = await app.json<{ orderId: string }>('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId: q.id }),
  })
  const s = (await app.pspSessions()).at(-1)
  app.setPspSession(s!.session.id, paidSession)
  await app.pspWebhook({
    id: `evt_paid_${++eventSeq}`,
    type: 'checkout.session.completed',
    sessionId: s!.session.id,
  })
  return body.orderId
}

describe('Operator API auth', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('401s without a credential, with a wrong bearer, and with a forged cookie', async () => {
    app = await boot()
    expect((await app.fetch('/api/operator/health')).status).toBe(401)
    expect(
      (await app.fetch('/api/operator/health', { headers: { authorization: 'Bearer nope' } }))
        .status,
    ).toBe(401)
    expect(
      (
        await app.fetch('/api/operator/health', {
          headers: { cookie: 'pressline_operator=9999999999999.' + 'a'.repeat(64) },
        })
      ).status,
    ).toBe(401)
  })

  it('accepts the bearer token, and a session cookie minted from it; a cookie cannot mint a session', async () => {
    app = await boot()
    expect((await app.fetch('/api/operator/health', { headers: bearer })).status).toBe(200)
    const session = await app.json<{ cookie: string; expiresAt: number }>('/api/operator/session', {
      method: 'POST',
      headers: bearer,
    })
    expect(session.status).toBe(200)
    expect(session.body.expiresAt - Date.now()).toBeGreaterThan(11 * 3600_000)
    const cookie = { cookie: `pressline_operator=${session.body.cookie}` }
    expect((await app.fetch('/api/operator/health', { headers: cookie })).status).toBe(200)
    expect(
      (await app.fetch('/api/operator/session', { method: 'POST', headers: cookie })).status,
    ).toBe(401)
    // Expired sessions stop working.
    app.advanceClock('13 hours')
    expect((await app.fetch('/api/operator/health', { headers: cookie })).status).toBe(401)
  })
})

describe('Operator read API', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('lists orders newest first with a state filter and cursor paging', async () => {
    app = await boot()
    const a = await placeAndPay(app)
    const b = await placeAndPay(app)
    const all = await app.json<List>('/api/operator/orders?limit=1', { headers: bearer })
    expect(all.body.orders.map((o) => o.id)).toEqual([b])
    expect(all.body.nextCursor).toBe(b)
    const next = await app.json<List>(`/api/operator/orders?limit=1&before=${b}`, {
      headers: bearer,
    })
    expect(next.body.orders.map((o) => o.id)).toEqual([a])
    expect(next.body.nextCursor).toBeUndefined()
    const none = await app.json<List>('/api/operator/orders?state=refunded', { headers: bearer })
    expect(none.body.orders).toEqual([])
    const submitted = await app.json<List>('/api/operator/orders?state=submitted', {
      headers: bearer,
    })
    expect(submitted.body.orders).toHaveLength(2)
  })

  it('shows one order in full: Recipient, Transitions with Causes, Inbound Events, emails and dashboard links', async () => {
    app = await boot()
    const id = await placeAndPay(app)
    const { status, body } = await app.json<Detail>(`/api/operator/orders/${id}`, {
      headers: bearer,
    })
    expect(status).toBe(200)
    expect(body.order.recipient).toMatchObject({
      name: 'Anna Example',
      address1: 'Torstraße 1',
      email: 'anna@example.com',
    })
    expect(body.transitions.map((t) => [t.to, t.cause])).toEqual([
      ['checkout_open', 'storefront'],
      ['paid', 'stripe_webhook'],
      ['submitted', 'stripe_webhook'],
    ])
    expect(
      body.inboundEvents.map((e) => [e.provider, e.eventId.startsWith('evt_paid_'), e.outcome]),
    ).toEqual([['stripe', true, 'applied']])
    expect(body.emails.map((e) => [e.kind, !!e.sentAt])).toEqual([['confirmation', true]])
    expect(body.links.stripePayment).toBe('https://dashboard.stripe.com/payments/pi_3Test123')
    expect(body.links.printfulOrder).toMatch(/order_id=\d+$/)
    expect((await app.fetch('/api/operator/orders/nope', { headers: bearer })).status).toBe(404)
  })

  it('carries the Printfile Inspection snapshotted at sale, and nothing else about it (#87)', async () => {
    app = await boot()
    const id = await placeAndPay(app)
    const { body } = await app.json<Detail>(`/api/operator/orders/${id}`, { headers: bearer })
    // The fixture declares no color space and stamps no DPI: sellable, and recorded.
    expect(body.order.printfile.inspection?.header).toMatchObject({ format: 'png', width: 1800 })
    expect(body.order.printfile.inspection?.deviations.map((d) => d.code)).toEqual([
      'color_undeclared',
      'dpi_missing',
    ])
    // An Order placed before migration 14 has no snapshot, and says so rather than guessing.
    await app.run(
      Effect.flatMap(Db, (db) => db.run('UPDATE orders SET printfile_inspection = NULL')),
    )
    const { body: old } = await app.json<Detail>(`/api/operator/orders/${id}`, { headers: bearer })
    expect(old.order.printfile.inspection).toBeUndefined()
  })

  it('reports instance health: engines, webhook registration, config summary, schema, counts', async () => {
    app = await boot()
    await placeAndPay(app)
    const { body } = await app.json<Health>('/api/operator/health', { headers: bearer })
    expect(body.engines[0]).toMatchObject({ slug: 'sample', enabled: true })
    expect(body.webhooks).toEqual({
      stripe: { configured: true, url: 'https://pressline.test/webhooks/stripe' },
      printful: { configured: true, url: 'https://pressline.test/webhooks/printful' },
    })
    expect(body.config).toEqual({
      name: 'Test Shop',
      currency: 'EUR',
      offers: 2,
      demo: false,
      mailer: 'memory',
    })
    expect(body.schema.version).toBe(body.schema.latest)
    expect(body.counts).toEqual({ submitted: 1 })
  })
})
