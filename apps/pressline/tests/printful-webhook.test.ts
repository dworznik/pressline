import type { DesignResponse } from '@pressline/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { findOrder } from '$lib/server/orders/orders'
import type { PublicOrder } from '$lib/server/orders/public'
import type { Quote } from '$lib/server/quote/quote'
import { catalog, offers } from './fixtures/catalog'
import { png } from './fixtures/images'
import { PROVIDER_FAILED_NOTE } from '$lib/server/webhooks/printful'
import { makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness'

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

/** Quote → Printfile → checkout → paid → submitted; returns ids. */
const submittedOrder = async (app: TestApp) => {
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
  const [po] = app.providerOrders()
  return { orderId: body.orderId, token, providerOrderId: po!.id }
}

const stateOf = async (app: TestApp, orderId: string, token: string) =>
  (await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)).body

describe('POST /webhooks/printful', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('order_updated → in_production once the provider says inprocess (the body alone is not enough)', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    expect((await stateOf(app, orderId, token)).state).toBe('submitted')

    // The delivery claims inprocess but the provider still says pending: ignored… (re-fetch wins)
    const early = await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId, status: 'inprocess' } },
    })
    expect(early.body.outcome).toBe('applied:already')
    expect((await stateOf(app, orderId, token)).state).toBe('submitted')

    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    const { status, body } = await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId, status: 'inprocess' } },
    })
    expect(status).toBe(200)
    expect(body.outcome).toMatch(/^applied/)
    expect((await stateOf(app, orderId, token)).state).toBe('in_production')
  })

  it('hold and resume: order_put_hold → on_hold, order_remove_hold → back to what the provider says', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'onhold')
    await app.printfulWebhook({
      type: 'order_put_hold',
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId }, reason: 'address' } as never,
    })
    expect((await stateOf(app, orderId, token)).state).toBe('on_hold')
    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    await app.printfulWebhook({
      type: 'order_remove_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect((await stateOf(app, orderId, token)).state).toBe('in_production')
  })

  it('order_failed after confirmation (payment, file) → on_hold with a note for the Operator, never submit_failed', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'failed')
    const { body } = await app.printfulWebhook({
      type: 'order_failed',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(body.outcome).toBe('applied')
    expect((await stateOf(app, orderId, token)).state).toBe('on_hold')
    const detail = (
      await app.json<{ transitions: ReadonlyArray<{ to: string; note?: string | null }> }>(
        `/api/operator/orders/${orderId}`,
        { headers: { authorization: `Bearer ${OPERATOR_TOKEN}` } },
      )
    ).body
    expect(detail.transitions.at(-1)).toMatchObject({
      to: 'on_hold',
      note: expect.stringContaining('provider reports the order failed'),
    })
  })

  it('order_failed on an order already on_hold: a same-state Transition carries the reason, once', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'onhold')
    await app.printfulWebhook({
      type: 'order_put_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId }, reason: 'address' } as never,
    })
    app.setProviderOrderStatus(providerOrderId, 'failed')
    const first = await app.printfulWebhook({
      type: 'order_failed',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(first.body.outcome).toBe('applied:noted')
    expect((await stateOf(app, orderId, token)).state).toBe('on_hold')
    const read = async () =>
      (
        await app.json<{
          transitions: ReadonlyArray<{ from: string | null; to: string; note?: string }>
          inboundEvents: ReadonlyArray<{ eventType: string }>
        }>(`/api/operator/orders/${orderId}`, {
          headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
        })
      ).body
    let detail = await read()
    expect(detail.transitions.at(-1)).toMatchObject({
      from: 'on_hold',
      to: 'on_hold',
      note: PROVIDER_FAILED_NOTE,
    })
    expect(detail.inboundEvents.at(-1)).toMatchObject({ eventType: 'order_failed' })
    // The same reason again adds nothing.
    const again = await app.printfulWebhook({
      type: 'order_failed',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(again.body.outcome).toBe('applied:already')
    detail = await read()
    expect(detail.transitions.filter((t) => t.to === 'on_hold')).toHaveLength(2)

    // Released, put back on hold, and failed again for the same reason. This is a
    // second stay in the state, so the Operator hears it a second time: "once per
    // reason" is about this stay, not about the Order's whole history.
    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    await app.printfulWebhook({
      type: 'order_remove_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect((await stateOf(app, orderId, token)).state).toBe('in_production')
    app.setProviderOrderStatus(providerOrderId, 'onhold')
    await app.printfulWebhook({
      type: 'order_put_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId }, reason: 'address' } as never,
    })
    expect((await stateOf(app, orderId, token)).state).toBe('on_hold')

    // Now the Transition is refused as same-state, so this goes through `annotate`.
    app.setProviderOrderStatus(providerOrderId, 'failed')
    const relapse = await app.printfulWebhook({
      type: 'order_failed',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(relapse.body.outcome).toBe('applied:noted')
    detail = await read()
    expect(detail.transitions.at(-1)).toMatchObject({
      from: 'on_hold',
      to: 'on_hold',
      note: PROVIDER_FAILED_NOTE,
    })
    expect(detail.transitions.filter((t) => t.note === PROVIDER_FAILED_NOTE)).toHaveLength(2)
  })

  it('shipment_sent → shipped with tracking number, carrier and URL', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'partial')
    app.setProviderShipments(providerOrderId, [
      {
        id: '1',
        status: 'shipped',
        carrier: 'DHL',
        trackingNumber: '00340434161234567890',
        trackingUrl: 'https://dhl.test/t/00340434161234567890',
      },
    ])
    const { body } = await app.printfulWebhook({
      type: 'shipment_sent',
      occurred_at: new Date().toISOString(),
      data: {
        order: { id: providerOrderId, external_id: orderId },
        shipment: { id: '1', status: 'shipped' },
      },
    })
    expect(body.outcome).toMatch(/^applied/)
    const order = await stateOf(app, orderId, token)
    expect(order.state).toBe('shipped')
    expect(order.tracking).toEqual({
      carrier: 'DHL',
      url: 'https://dhl.test/t/00340434161234567890',
    })
  })

  it('shipped → fulfilled when the provider reports fulfilled; canceled on order_canceled', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'fulfilled')
    app.setProviderShipments(providerOrderId, [
      { id: '1', status: 'shipped', trackingNumber: 'X1' },
    ])
    await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect((await stateOf(app, orderId, token)).state).toBe('fulfilled') // skipped straight past shipped: missed webhooks happen

    app = await (async () => {
      await app.dispose()
      return boot()
    })()
    const second = await submittedOrder(app)
    app.setProviderOrderStatus(second.providerOrderId, 'canceled')
    await app.printfulWebhook({
      type: 'order_canceled',
      occurred_at: new Date().toISOString(),
      data: { order: { id: second.providerOrderId, external_id: second.orderId } },
    })
    expect((await stateOf(app, second.orderId, second.token)).state).toBe('canceled')
  })

  it('acknowledges a duplicate delivery and refuses an out-of-order one', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'fulfilled')
    const ev = {
      type: 'order_updated',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    }
    expect((await app.printfulWebhook(ev)).body.outcome).toMatch(/^applied/)
    expect((await app.printfulWebhook(ev)).body.outcome).toMatch(/^duplicate:applied/) // Printful's retry
    // A stale "in process" arriving after fulfillment (different occurred_at) is refused: fulfilled is terminal.
    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    const stale = await app.printfulWebhook({
      ...ev,
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
    })
    expect(stale.body.outcome).toBe('refused:fulfilled->in_production')
    expect((await stateOf(app, orderId, token)).state).toBe('fulfilled')
  })

  it('rejects a signed delivery whose occurred_at is stale or from the future', async () => {
    app = await boot()
    const { orderId, providerOrderId } = await submittedOrder(app)
    const stale = await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: '2020-01-01T00:00:00Z',
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(stale.status).toBe(400)
    const future = await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: new Date(Date.now() + 3_600_000).toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(future.status).toBe(400)
  })

  it('a shipment_sent arriving before the "in process" update still lands as shipped, with the tracking number kept', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    app.setProviderShipments(providerOrderId, [
      {
        id: '7',
        status: 'shipped',
        carrier: 'DPD',
        trackingNumber: 'DPD-777',
        trackingUrl: 'https://dpd.test/DPD-777',
      },
    ])
    const { body } = await app.printfulWebhook({
      type: 'shipment_sent',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId }, shipment: { id: '7' } },
    })
    expect(body.outcome).toMatch(/^applied/)
    expect((await stateOf(app, orderId, token)).state).toBe('shipped')
    const full = await app.run(findOrder(orderId))
    expect(full._tag === 'Success' && full.value.tracking).toEqual({
      carrier: 'DPD',
      number: 'DPD-777',
      url: 'https://dpd.test/DPD-777',
    })
    // The late "in process" update is now stale and refused.
    const late = await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect(late.body.outcome).toBe('refused:shipped->in_production')
  })

  it('on_hold → submitted when the provider resumes to pending', async () => {
    app = await boot()
    const { orderId, token, providerOrderId } = await submittedOrder(app)
    app.setProviderOrderStatus(providerOrderId, 'onhold')
    await app.printfulWebhook({
      type: 'order_put_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    app.setProviderOrderStatus(providerOrderId, 'pending')
    await app.printfulWebhook({
      type: 'order_remove_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: orderId } },
    })
    expect((await stateOf(app, orderId, token)).state).toBe('submitted')
  })

  it('rejects a bad signature with 400, and records unknown provider orders', async () => {
    app = await boot()
    expect(
      (await app.printfulWebhook({ type: 'order_updated', data: { order: { id: '999' } } }, 'nope'))
        .status,
    ).toBe(400)
    const unknown = await app.printfulWebhook({
      type: 'order_updated',
      data: { order: { id: '999', external_id: 'not-ours' } },
    })
    expect(unknown.status).toBe(200)
    expect(unknown.body.outcome).toBe('unknown_order:999')
  })
})
