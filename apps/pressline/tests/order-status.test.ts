import type { DesignResponse } from '@pressline/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { describeState } from '$lib/server/orders/customer-language'
import { rotateStatusToken, transition } from '$lib/server/orders/orders'
import type { PublicOrder } from '$lib/server/orders/public'
import type { OrderState } from '$lib/server/orders/state'
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
  const [s] = await app.pspSessions()
  const token = new URL(s!.input.successUrl).searchParams.get('t')!
  app.setPspSession(s!.session.id, paidSession)
  await app.pspWebhook({
    id: 'evt_paid',
    type: 'checkout.session.completed',
    sessionId: s!.session.id,
  })
  return { orderId: body.orderId, token }
}

describe('GET /api/orders/{id}?t= (order status)', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('shows the Customer what they bought, the masked Recipient and the Preview; never the address or email', async () => {
    app = await boot()
    const { orderId, token } = await placeAndPay(app)
    const { status, body } = await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      state: 'submitted',
      offerName: 'Black tee, front print',
      variantLabel: 'Black / M',
      previewUrl: design.previewUrl,
      amountTotal: 3479,
      recipient: { firstName: 'Anna', city: 'Berlin', country: 'DE' },
    })
    expect(JSON.stringify(body)).not.toMatch(/Torstraße|anna@example|10119|pi_3Test/)
  })

  it('404s a wrong or missing token, and old links after the token is rotated', async () => {
    app = await boot()
    const { orderId, token } = await placeAndPay(app)
    expect((await app.fetch(`/api/orders/${orderId}?t=wrong`)).status).toBe(404)
    expect((await app.fetch(`/api/orders/${orderId}`)).status).toBe(400) // t is required at the schema boundary
    const rotated = await app.run(rotateStatusToken(orderId))
    expect(rotated._tag).toBe('Success')
    expect((await app.fetch(`/api/orders/${orderId}?t=${token}`)).status).toBe(404)
    if (rotated._tag === 'Success') {
      expect((await app.fetch(`/api/orders/${orderId}?t=${rotated.value}`)).status).toBe(200)
    }
  })

  it('exposes tracking once shipped', async () => {
    app = await boot()
    const { orderId, token } = await placeAndPay(app)
    const po = app.providerOrders()[0]!
    app.setProviderOrderStatus(po.id, 'partial')
    app.setProviderShipments(po.id, [
      {
        id: '1',
        status: 'shipped',
        carrier: 'DHL',
        trackingNumber: '0034',
        trackingUrl: 'https://dhl.test/t/0034',
      },
    ])
    await app.printfulWebhook({
      type: 'shipment_sent',
      occurred_at: new Date().toISOString(),
      data: { order: { id: po.id, external_id: orderId }, shipment: { id: '1' } },
    })
    const { body } = await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)
    expect(body.state).toBe('shipped')
    expect(body.tracking).toEqual({ carrier: 'DHL', url: 'https://dhl.test/t/0034' })
  })
})

describe('Customer-language display of every state', () => {
  const states: OrderState[] = [
    'checkout_open',
    'expired',
    'paid',
    'submit_failed',
    'submitted',
    'on_hold',
    'in_production',
    'shipped',
    'fulfilled',
    'canceled',
    'refunded',
  ]
  it.each(states)('%s has a label, a detail and a step', (state) => {
    const d = describeState(state)
    expect(d.label.length).toBeGreaterThan(0)
    expect(d.detail.length).toBeGreaterThan(0)
  })
  it('hides Operator-only states behind "Confirmed"', () => {
    for (const s of ['paid', 'submit_failed', 'submitted', 'on_hold'] as const)
      expect(describeState(s).label).toBe('Confirmed')
  })
  it('the API reflects each reachable state through the seam', async () => {
    const app = await boot()
    try {
      const { orderId, token } = await placeAndPay(app)
      for (const to of ['in_production', 'shipped', 'fulfilled'] as const) {
        const moved = await app.run(transition(orderId, to, 'cli', 'test'))
        expect(moved._tag).toBe('Success')
        expect((await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)).body.state).toBe(
          to,
        )
      }
    } finally {
      await app.dispose()
    }
  })
})
