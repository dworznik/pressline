import type { DesignResponse } from '@pressline/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { listOrderEmails } from '$lib/server/emails/send'
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
    config: { catalog: { offers }, legal: { contactEmail: 'help@shop.test' } },
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
  const ack = await app.pspWebhook({
    id: 'evt_paid',
    type: 'checkout.session.completed',
    sessionId: s!.session.id,
  })
  return {
    orderId: body.orderId,
    token,
    sessionId: s!.session.id,
    ack,
    providerOrderId: app.providerOrders()[0]?.id,
  }
}

describe('Customer emails', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('sends one confirmation on paid: order ref, Preview, Withdrawal Notice, contact and status link', async () => {
    app = await boot()
    const { orderId, token, ack } = await placeAndPay(app)
    expect(ack.body.outcome).toMatch(/email=sent/)
    const sent = await app.sentMail()
    expect(sent).toHaveLength(1)
    const mail = sent[0]!
    expect(mail.to).toBe('anna@example.com')
    expect(mail.subject).toBe(
      `Test Shop: order ${orderId.replaceAll('-', '').slice(-8).toUpperCase()} confirmed`,
    )
    expect(mail.html).toContain(design.previewUrl)
    expect(mail.html).toContain('right of withdrawal')
    expect(mail.html).toContain('help@shop.test')
    expect(mail.html).toContain(`http://pressline.test/orders/${orderId}?t=${token}`)
    expect(mail.text).toContain('Black tee, front print · Black / M')
    expect(mail.text).toContain('€34.79')
    expect(mail.idempotencyKey).toBe(`${orderId}:confirmation`)
  })

  it('does not send the confirmation twice on a redelivered webhook', async () => {
    app = await boot()
    const { sessionId } = await placeAndPay(app)
    await app.pspWebhook({ id: 'evt_again', type: 'checkout.session.completed', sessionId })
    expect(await app.sentMail()).toHaveLength(1)
  })

  it('sends the shipped email with the tracking link once the Order ships', async () => {
    app = await boot()
    const { orderId, providerOrderId } = await placeAndPay(app)
    app.setProviderOrderStatus(providerOrderId!, 'partial')
    app.setProviderShipments(providerOrderId!, [
      {
        id: '1',
        status: 'shipped',
        carrier: 'DHL',
        trackingNumber: '0034',
        trackingUrl: 'https://dhl.test/t/0034',
      },
    ])
    const { body } = await app.printfulWebhook({
      type: 'shipment_sent',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId!, external_id: orderId }, shipment: { id: '1' } },
    })
    expect(body.outcome).toBe('applied:email=sent')
    const sent = await app.sentMail()
    expect(sent).toHaveLength(2)
    expect(sent[1]!.subject).toMatch(/is on its way$/)
    expect(sent[1]!.html).toContain('https://dhl.test/t/0034')
    expect(sent[1]!.text).toContain('DHL')
  })

  it('still sends the shipped email when a missed webhook lands the Order straight on fulfilled', async () => {
    app = await boot()
    const { orderId, providerOrderId } = await placeAndPay(app)
    app.setProviderOrderStatus(providerOrderId!, 'fulfilled')
    app.setProviderShipments(providerOrderId!, [
      { id: '1', status: 'shipped', trackingUrl: 'https://dhl.test/t/1' },
    ])
    await app.printfulWebhook({
      type: 'order_updated',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId!, external_id: orderId } },
    })
    const sent = await app.sentMail()
    expect(sent.map((m) => m.subject.replace(/order \w+ /, 'order X '))).toEqual([
      'Test Shop: order X confirmed',
      'Test Shop: order X is on its way',
    ])
  })

  it('a Mailer failure is recorded for retry and never blocks the Transition', async () => {
    app = await boot()
    app.mailerDown(true)
    const { orderId, token, ack } = await placeAndPay(app)
    expect(ack.status).toBe(200)
    expect(ack.body.outcome).toMatch(/email=failed/)
    expect(
      (await app.json<{ state: string }>(`/api/orders/${orderId}?t=${token}`)).body.state,
    ).toBe('submitted')
    const emails = await app.run(listOrderEmails(orderId))
    expect(emails._tag === 'Success' && emails.value).toEqual([
      { orderId, kind: 'confirmation', attempts: 1, lastError: 'mailer unreachable' },
    ])
  })
})
