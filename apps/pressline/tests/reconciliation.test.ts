import type { DesignResponse } from '@pressline/contract'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrderDetail } from '$lib/server/operator/read'
import type { Quote } from '$lib/server/quote/quote'
import type { ReconciliationReport } from '$lib/server/reconciliation/run'
import { catalog, offers } from './fixtures/catalog'
import { png } from './fixtures/images'
import { CRON_SECRET, makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness'

type Detail = typeof OrderDetail.Type

const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
}
const URL_OK = 'https://engine.test/files/heron/front.png'
const boot = (orders?: { createRejects?: string; createRetryableFailures?: number }) =>
  makeTestApp({
    config: { catalog: { offers }, email: { operator: 'ops@shop.example' } },
    catalog: orders ? { ...catalog, orders } : catalog,
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
  customer: { email: 'anna@example.com', name: 'Anna Example' },
  shipping: {
    name: 'Anna Example',
    address1: 'Torstraße 1',
    city: 'Berlin',
    zip: '10119',
    country: 'DE',
  },
}
let seq = 0

const checkout = async (app: TestApp) => {
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
  const session = (await app.pspSessions()).at(-1)!.session.id
  return { orderId: body.orderId, session }
}
const pay = async (app: TestApp, session: string, paymentIntentId = `pi_${++seq}`) => {
  app.setPspSession(session, { ...paidSession, paymentIntentId })
  await app.pspWebhook({
    id: `evt_${++seq}`,
    type: 'checkout.session.completed',
    sessionId: session,
  })
}
const reconcile = async (app: TestApp) => {
  const res = await app.json<ReconciliationReport>('/api/operator/reconcile', {
    method: 'POST',
    headers: bearer,
  })
  expect(res.status).toBe(200)
  return res.body
}
const detail = async (app: TestApp, id: string) =>
  (await app.json<Detail>(`/api/operator/orders/${id}`, { headers: bearer })).body

describe('Reconciliation entry points', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('runs from the operator API, persists the report, and the cron route needs its own secret', async () => {
    app = await boot()
    const report = await reconcile(app)
    expect(report.trigger).toBe('operator')
    expect(Object.keys(report.steps)).toEqual([
      'staleCheckouts',
      'stuckPaid',
      'providerCatchUp',
      'refundsAndDisputes',
      'inboundEvents',
      'emails',
      'engines',
      'catalog',
    ])
    expect(report.alarms).toEqual([])
    const latest = await app.json<ReconciliationReport>('/api/operator/reconciliation/latest', {
      headers: bearer,
    })
    expect(latest.body).toEqual(report)

    expect((await app.fetch('/api/cron/reconcile')).status).toBe(401)
    expect((await app.fetch('/api/cron/reconcile', { headers: bearer })).status).toBe(401)
    const cron = await app.json<ReconciliationReport>('/api/cron/reconcile', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(cron.status).toBe(200)
    expect(cron.body.trigger).toBe('cron')
    // A quiet run emails nobody.
    expect(await app.sentMail()).toEqual([])
  })
})

describe('Reconciliation repairs', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('expires stale checkouts once their session has died, and settles one that was paid but never announced', async () => {
    app = await boot()
    const abandoned = await checkout(app)
    const missedWebhook = await checkout(app)
    const fresh = await checkout(app)
    app.setPspSession(missedWebhook.session, { ...paidSession, paymentIntentId: 'pi_missed' })

    // The session dies after an hour; the sweep waits a half-hour longer for a late
    // `checkout.session.expired` before acting on its own (#152).
    app.advanceClock('80 minutes')
    expect((await reconcile(app)).steps.staleCheckouts).toMatchObject({ checked: 0, repaired: 0 })
    expect((await detail(app, abandoned.orderId)).order.state).toBe('checkout_open')

    app.advanceClock('20 minutes')
    const late = await checkout(app)

    const report = await reconcile(app)
    expect(report.steps.staleCheckouts).toMatchObject({ checked: 3, repaired: 3 })
    expect((await detail(app, abandoned.orderId)).order.state).toBe('expired')
    expect((await detail(app, fresh.orderId)).order.state).toBe('expired')
    expect((await detail(app, late.orderId)).order.state).toBe('checkout_open')
    const settled = await detail(app, missedWebhook.orderId)
    expect(settled.order.state).toBe('submitted')
    expect(settled.transitions.map((t) => [t.to, t.cause])).toEqual([
      ['checkout_open', 'storefront'],
      ['paid', 'reconciliation'],
      ['submitted', 'reconciliation'],
    ])
    expect((await app.sentMail()).map((m) => m.subject)).toHaveLength(1)
  })

  it('leaves a delayed payment alone: the sweep expires abandonment, not settlement', async () => {
    // ACH, SEPA, Boleto and friends complete the Session `unpaid` and settle days
    // later. Expiring one dead-ends it — `expired` has no outgoing edges — so the
    // settlement is refused and the Customer has paid for an Order that never ships.
    app = await boot()
    const { orderId, session } = await checkout(app)
    app.setPspSession(session, {
      status: 'complete',
      paymentStatus: 'unpaid',
      consentAccepted: true,
      customer: { email: 'anna@example.com' },
    })

    app.advanceClock('2 hours')
    const report = await reconcile(app)
    expect((await detail(app, orderId)).order.state).toBe('checkout_open')
    expect(report.steps.staleCheckouts?.notes).toEqual([
      `${orderId}: awaiting a delayed payment (session complete, still unpaid)`,
    ])

    // Days later the bank settles, and the Order is still able to take it.
    app.advanceClock('3 days')
    app.setPspSession(session, { ...paidSession, paymentIntentId: 'pi_settled' })
    const ack = await app.pspWebhook({
      id: 'evt_settled',
      type: 'checkout.session.async_payment_succeeded',
      sessionId: session,
    })
    expect(ack.body.outcome).toMatch(/^applied/)
    expect((await detail(app, orderId)).order.state).toBe('submitted')
  })

  it('submits a paid Order the webhook could not, and alarms for one that failed outright', async () => {
    // Four retryable failures exhaust the webhook's retry budget; the Order stays paid.
    app = await boot({ createRetryableFailures: 4 })
    const { orderId, session } = await checkout(app)
    await pay(app, session)
    expect((await detail(app, orderId)).order.state).toBe('paid')
    // Not yet stale: left alone.
    app.advanceClock('5 minutes')
    let report = await reconcile(app)
    expect(report.steps.stuckPaid).toMatchObject({ checked: 0 })
    app.advanceClock('11 minutes')
    report = await reconcile(app)
    expect(report.steps.stuckPaid).toMatchObject({ checked: 1, repaired: 1 })
    expect(report.alarms).toEqual([])
    const d = await detail(app, orderId)
    expect(d.order.state).toBe('submitted')
    expect(d.transitions.at(-1)).toMatchObject({ to: 'submitted', cause: 'reconciliation' })
    await app.dispose()

    app = await boot({ createRejects: 'Printful is unhappy' })
    const failed = await checkout(app)
    await pay(app, failed.session)
    expect((await detail(app, failed.orderId)).order.state).toBe('submit_failed')
    report = await reconcile(app)
    expect(report.alarms).toEqual([
      {
        kind: 'submit_failed',
        orderId: failed.orderId,
        message: 'submission failed; fix and resubmit',
      },
    ])
    const mail = await app.sentMail()
    expect(mail.at(-1)?.to).toBe('ops@shop.example')
    expect(mail.at(-1)?.subject).toBe('Test Shop: 1 thing needs attention')
    expect(mail.at(-1)?.text).toContain(failed.orderId)
  })

  it('catches up provider status the webhooks missed', async () => {
    app = await boot()
    const { orderId, session } = await checkout(app)
    await pay(app, session)
    const providerOrderId = (await detail(app, orderId)).order.providerOrderId!
    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    let report = await reconcile(app)
    expect(report.steps.providerCatchUp).toMatchObject({ checked: 1, repaired: 1 })
    const moved = await detail(app, orderId)
    expect(moved.order.state).toBe('in_production')
    expect(moved.transitions.at(-1)).toMatchObject({
      to: 'in_production',
      cause: 'reconciliation',
    })

    app.setProviderOrderStatus(providerOrderId, 'onhold')
    report = await reconcile(app)
    expect((await detail(app, orderId)).order.state).toBe('on_hold')
    expect(report.alarms).toEqual([
      { kind: 'on_hold', orderId, message: 'provider has the order on hold' },
    ])

    // Nothing changed: nothing repaired, no new Transition, same Alarm.
    report = await reconcile(app)
    expect(report.steps.providerCatchUp?.repaired).toBe(0)
    expect((await detail(app, orderId)).transitions.filter((t) => t.to === 'on_hold')).toHaveLength(
      1,
    )
  })

  it('ends the provider pass when the limiter bites instead of holding the store in a lockout', async () => {
    // The limiter is store-wide and the lockout lasts a minute, so a nightly pass
    // that keeps walking Orders can fail a submit for a *new* paid Order (#153).
    app = await boot()
    const orders: string[] = []
    for (let i = 0; i < 3; i++) {
      const { orderId, session } = await checkout(app)
      await pay(app, session)
      orders.push(orderId)
    }

    // One provider read gets through; the next is a 429.
    app.setProviderRateLimited(1)
    const limited = await reconcile(app)
    expect(limited.steps.providerCatchUp).toMatchObject({ checked: 1, repaired: 0 })
    expect(limited.steps.providerCatchUp?.notes).toEqual([
      'rate limited by the provider: pass ended after 1 of 3 open Orders, the rest are still open',
    ])
    expect(limited.alarms).toEqual([
      {
        kind: 'provider_status',
        message:
          'provider rate limit reached: the pass handled 1 of 3 open Orders and stopped; the next run continues',
      },
    ])

    // The lockout lifts: the next run walks all three, including the ones it never reached.
    app.setProviderRateLimited(undefined)
    const full = await reconcile(app)
    expect(full.steps.providerCatchUp).toMatchObject({ checked: 3 })
    expect(full.steps.providerCatchUp?.notes).toEqual([])
    expect(full.alarms).toEqual([])
  })

  it('yields before the wall when the provider publishes what is left of the window', async () => {
    // Stopping on a 429 means the lockout has already been earned. Printful says
    // on every response how much of the window is left, so the pass can hand the
    // rest back and never trip it (#153).
    app = await boot()
    for (let i = 0; i < 3; i++) {
      const { session } = await checkout(app)
      await pay(app, session)
    }

    app.setProviderRateLimitRemaining(3)
    const yielded = await reconcile(app)
    expect(yielded.steps.providerCatchUp).toMatchObject({ checked: 0, repaired: 0 })
    expect(yielded.steps.providerCatchUp?.notes).toEqual([
      "close to the provider's rate limit (3 of 120 left): pass ended after 0 of 3 open Orders, the rest are still open",
    ])
    expect(yielded.alarms).toEqual([
      {
        kind: 'provider_status',
        message:
          'provider rate limit reached: the pass handled 0 of 3 open Orders and stopped; the next run continues',
      },
    ])

    // The window refills: the next run walks all three, having never been locked out.
    app.setProviderRateLimitRemaining(undefined)
    const full = await reconcile(app)
    expect(full.steps.providerCatchUp).toMatchObject({ checked: 3 })
    expect(full.alarms).toEqual([])
  })

  it('stops resubmitting stuck Orders into a lockout too', async () => {
    // The stuck-paid pass runs before the catch-up pass and also calls the provider
    // per Order, so it has to yield to the limiter for the same reason (#153).
    app = await boot({ createRetryableFailures: 100 })
    for (let i = 0; i < 3; i++) {
      const { session } = await checkout(app)
      await pay(app, session)
    }
    app.advanceClock('20 minutes')
    app.setProviderRateLimited(0)

    const report = await reconcile(app)
    expect(report.steps.stuckPaid).toMatchObject({ checked: 0, repaired: 0 })
    expect(report.steps.stuckPaid?.notes).toEqual([
      'rate limited by the provider: pass ended after 0 of 3 stuck Orders, the rest are still paid',
    ])
    expect(report.alarms).toContainEqual({
      kind: 'provider_status',
      message:
        'provider rate limit reached: the pass handled 0 of 3 stuck Orders and stopped; the next run continues',
    })
    // No Order was dragged into submit_failed by a limiter that says nothing about it.
    const { body } = await app.json<{ orders: { state: string }[] }>('/api/operator/orders', {
      headers: bearer,
    })
    expect(body.orders.map((o) => o.state)).toEqual(['paid', 'paid', 'paid'])
  })

  it('a confirmed order the provider then fails (payment, file) goes on_hold and alarms', async () => {
    app = await boot()
    const { orderId, session } = await checkout(app)
    await pay(app, session)
    const providerOrderId = (await detail(app, orderId)).order.providerOrderId!
    app.setProviderOrderStatus(providerOrderId, 'failed')
    const report = await reconcile(app)
    expect((await detail(app, orderId)).order.state).toBe('on_hold')
    expect(report.alarms).toEqual([
      {
        kind: 'on_hold',
        orderId,
        message: expect.stringContaining('provider reports the order failed'),
      },
    ])
  })

  it('an order already on_hold that the provider then fails stays put, and the alarm carries the reason', async () => {
    app = await boot()
    const { orderId, session } = await checkout(app)
    await pay(app, session)
    const providerOrderId = (await detail(app, orderId)).order.providerOrderId!
    app.setProviderOrderStatus(providerOrderId, 'onhold')
    await reconcile(app)
    app.setProviderOrderStatus(providerOrderId, 'failed')
    const report = await reconcile(app)
    expect(report.steps.providerCatchUp?.repaired).toBe(0)
    const after = await detail(app, orderId)
    expect(after.order.state).toBe('on_hold')
    expect(after.transitions.filter((t) => t.to === 'on_hold')).toHaveLength(1)
    expect(report.alarms).toEqual([
      {
        kind: 'on_hold',
        orderId,
        message: expect.stringContaining('provider reports the order failed'),
      },
    ])
  })

  it('records a partial refund without making the Order refunded, and only once per amount', async () => {
    // Stripe's `refunded` flag stays false for a partial refund, so the amount is
    // the only signal. Before #92 this Order was examined and silently skipped.
    app = await boot({ createRetryableFailures: 100 })
    const a = await checkout(app)
    await pay(app, a.session, 'pi_partial')
    const captured = (await detail(app, a.orderId)).order.amountTotal!
    app.setPspPayment('pi_partial', {
      refunded: false,
      amountRefunded: 1000,
    })

    let report = await reconcile(app)
    expect(report.alarms).toEqual([
      {
        kind: 'refund',
        orderId: a.orderId,
        message: `partial refund of 1000 of ${captured} recorded; the Order still ships`,
      },
    ])
    const after = await detail(app, a.orderId)
    // Still paid: a partial refund is a fact about the money, not the fulfillment.
    expect(after.order.state).toBe('paid')
    expect(after.transitions.at(-1)).toMatchObject({
      from: 'paid',
      to: 'paid',
      cause: 'reconciliation',
      note: `partially refunded 1000 of ${captured} at the PSP`,
    })

    // Nothing changed at the PSP: no second Transition, no second Alarm.
    report = await reconcile(app)
    expect(report.alarms).toEqual([])
    const again = await detail(app, a.orderId)
    expect(again.transitions).toHaveLength(after.transitions.length)

    // A further partial refund is a new amount, so a new row and a new Alarm.
    app.setPspPayment('pi_partial', { refunded: false, amountRefunded: 1500 })
    report = await reconcile(app)
    expect(report.alarms).toHaveLength(1)
    expect((await detail(app, a.orderId)).transitions.at(-1)).toMatchObject({
      note: `partially refunded 1500 of ${captured} at the PSP`,
    })

    // Refunded in full afterwards: now the Order really is refunded.
    app.setPspPayment('pi_partial', {
      refunded: true,
      amountRefunded: captured,
    })
    await reconcile(app)
    expect((await detail(app, a.orderId)).order.state).toBe('refunded')
  })

  it('records refunds and disputes the Operator handled at the PSP', async () => {
    // The provider is unreachable, so every Order below stays paid (not yet stale).
    app = await boot({ createRetryableFailures: 100 })
    const a = await checkout(app)
    await pay(app, a.session, 'pi_refunded')
    const b = await checkout(app)
    await pay(app, b.session, 'pi_disputed')
    app.setPspPayment('pi_refunded', { refunded: true, amountRefunded: 3479 })
    app.setPspPayment('pi_disputed', {
      refunded: false,
      amountRefunded: 0,
      dispute: { status: 'needs_response', amount: 3479, reason: 'fraudulent' },
    })

    const report = await reconcile(app)
    expect(report.alarms).toEqual([
      { kind: 'refund', orderId: a.orderId, message: 'refund of 3479 recorded' },
      {
        kind: 'dispute',
        orderId: b.orderId,
        message:
          'chargeback (needs_response) for 3479 (fraudulent): the funds are withheld until it closes',
      },
    ])
    const refunded = await detail(app, a.orderId)
    expect(refunded.order.state).toBe('refunded')
    expect(refunded.transitions.at(-1)).toMatchObject({
      to: 'refunded',
      cause: 'reconciliation',
      causeRef: 'pi_refunded',
    })
    expect((await detail(app, b.orderId)).order.state).toBe('paid')
    // Already recorded: the next run does not repeat the Transition.
    await reconcile(app)
    expect(
      (await detail(app, a.orderId)).transitions.filter((t) => t.to === 'refunded'),
    ).toHaveLength(1)
  })

  it('records every dispute state once, and a closed dispute never wakes the Operator', async () => {
    // A dispute walks eight states over 2-3 months. Before #95 it was one boolean,
    // so the Operator could not tell an inquiry from a chargeback and the Alarm
    // repeated every night forever, win or lose.
    app = await boot()
    const { orderId, session } = await checkout(app)
    await pay(app, session, 'pi_dispute')
    const providerOrderId = (await detail(app, orderId)).order.providerOrderId!

    // An inquiry: nothing is withdrawn yet, but it has a deadline.
    app.setPspPayment('pi_dispute', {
      refunded: false,
      amountRefunded: 0,
      dispute: { status: 'warning_needs_response', amount: 3479, reason: 'fraudulent' },
    })
    let report = await reconcile(app)
    expect(report.alarms).toEqual([
      {
        kind: 'dispute',
        orderId,
        message:
          'inquiry (warning_needs_response) for 3479 (fraudulent): no funds withdrawn, but answer it before it becomes a chargeback',
      },
    ])
    let seen = await detail(app, orderId)
    expect(seen.order.state).toBe('submitted')
    expect(seen.transitions.at(-1)).toMatchObject({
      from: 'submitted',
      to: 'submitted',
      cause: 'reconciliation',
      causeRef: 'pi_dispute',
      note: 'dispute warning_needs_response for 3479 at the PSP',
    })

    // Nothing moved at the PSP: no second row and no second Alarm.
    report = await reconcile(app)
    expect(report.alarms).toEqual([])
    expect((await detail(app, orderId)).transitions).toHaveLength(seen.transitions.length)

    // The Order moves on underneath the dispute, which runs for months. A dispute is
    // a fact about the payment, not about where the Order is, so every step from paid
    // to shipped must not re-announce the same one.
    app.setProviderOrderStatus(providerOrderId, 'inprocess')
    report = await reconcile(app)
    expect((await detail(app, orderId)).order.state).toBe('in_production')
    expect(report.alarms.filter((a) => a.kind === 'dispute')).toEqual([])
    expect(
      (await detail(app, orderId)).transitions.filter((t) => t.note?.startsWith('dispute ')),
    ).toHaveLength(1)

    // The inquiry became a real chargeback: a new state, so a new row and one Alarm.
    app.setPspPayment('pi_dispute', {
      refunded: false,
      amountRefunded: 0,
      dispute: { status: 'needs_response', amount: 3479, reason: 'fraudulent' },
    })
    report = await reconcile(app)
    expect(report.alarms).toEqual([
      {
        kind: 'dispute',
        orderId,
        message:
          'chargeback (needs_response) for 3479 (fraudulent): the funds are withheld until it closes',
      },
    ])

    // Lost: the money is gone, said once.
    app.setPspPayment('pi_dispute', {
      refunded: false,
      amountRefunded: 0,
      dispute: { status: 'lost', amount: 3479, reason: 'fraudulent' },
    })
    report = await reconcile(app)
    expect(report.alarms).toEqual([
      {
        kind: 'dispute',
        orderId,
        message: 'dispute lost (fraudulent): 3479 is withdrawn, along with the dispute fee',
      },
    ])

    // A late win. Recorded for the ledger; a closed dispute needs no human, tonight or ever.
    app.setPspPayment('pi_dispute', {
      refunded: false,
      amountRefunded: 0,
      dispute: { status: 'won', amount: 3479, reason: 'fraudulent' },
    })
    report = await reconcile(app)
    expect(report.alarms).toEqual([])
    seen = await detail(app, orderId)
    expect(seen.transitions.at(-1)).toMatchObject({ note: 'dispute won for 3479 at the PSP' })
    expect((await reconcile(app)).alarms).toEqual([])
    expect((await detail(app, orderId)).transitions).toHaveLength(seen.transitions.length)
  })

  it('records a refund after submission and tells the Operator to cancel at the provider', async () => {
    app = await boot()
    const { orderId, session } = await checkout(app)
    await pay(app, session, 'pi_late_refund')
    app.setPspPayment('pi_late_refund', { refunded: true, amountRefunded: 3479 })
    const report = await reconcile(app)
    expect(report.alarms).toEqual([
      {
        kind: 'refund',
        orderId,
        message:
          'refund of 3479 recorded while submitted: cancel it at the provider if it has not shipped',
      },
    ])
    expect((await detail(app, orderId)).order.state).toBe('refunded')
    // Recorded once: the next night is quiet.
    expect((await reconcile(app)).alarms).toEqual([])
  })

  it('a dry run reports what it would do and changes nothing', async () => {
    app = await boot({ createRetryableFailures: 4 })
    const { orderId, session } = await checkout(app)
    await pay(app, session)
    app.advanceClock('20 minutes')
    const dry = await app.json<ReconciliationReport>('/api/operator/reconcile?dryRun=true', {
      method: 'POST',
      headers: bearer,
    })
    expect(dry.body.dryRun).toBe(true)
    expect(dry.body.steps.stuckPaid).toMatchObject({ checked: 1, repaired: 0 })
    expect(dry.body.steps.stuckPaid?.notes[0]).toMatch(/would submit/)
    expect((await detail(app, orderId)).order.state).toBe('paid')
    const latest = await app.json<ReconciliationReport | null>(
      '/api/operator/reconciliation/latest',
      { headers: bearer },
    )
    expect(latest.body).toBeNull()
  })

  it('retries failed emails and reprocesses an Inbound Event whose claim lapsed', async () => {
    app = await boot()
    const { orderId, session } = await checkout(app)
    app.mailerDown(true)
    await pay(app, session)
    expect(await app.sentMail()).toEqual([])
    app.mailerDown(false)
    const report = await reconcile(app)
    expect(report.steps.emails).toMatchObject({ checked: 1, repaired: 1 })
    expect((await app.sentMail()).map((m) => m.subject)).toHaveLength(1)
    expect((await detail(app, orderId)).emails.map((e) => e.kind)).toEqual(['confirmation'])
  })

  it('reports Engines that are down and a Catalog that no longer resolves', async () => {
    const gone = { ...offers[0]!, slug: 'tee-gone', catalogProductId: 999 }
    app = await makeTestApp({
      config: { catalog: { offers: [...offers, gone] }, email: { operator: 'ops@shop.example' } },
      catalog,
      engines: { engines: { sample: { designs: {}, down: true } } },
    })
    const report = await reconcile(app)
    expect(report.alarms.map((a) => a.kind)).toEqual(['engine_disabled', 'catalog'])
    expect(report.alarms[1]?.message).toContain('tee-gone')
    expect(report.steps.engines).toMatchObject({ checked: 1 })
    const mail = await app.sentMail()
    expect(mail).toHaveLength(1)
    expect(mail[0]?.subject).toContain('2 things need attention')
  })
})

describe('Reconciliation replays Inbound Events', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('reprocesses a delivery that failed and was released', async () => {
    app = await boot()
    const { orderId, session } = await checkout(app)
    app.setPspSession(session, { ...paidSession, paymentIntentId: 'pi_replay' })
    app.pspDown(true)
    const failed = await app.pspWebhook({
      id: 'evt_replay',
      type: 'checkout.session.completed',
      sessionId: session,
    })
    expect(failed.status).toBe(500)
    expect((await detail(app, orderId)).order.state).toBe('checkout_open')
    app.pspDown(false)
    const report = await reconcile(app)
    expect(report.steps.inboundEvents).toMatchObject({ checked: 1, repaired: 1 })
    const d = await detail(app, orderId)
    expect(d.order.state).toBe('submitted')
    expect(d.inboundEvents.map((e) => [e.eventId, e.outcome])).toEqual([['evt_replay', 'applied']])
    // Settled now: a second run finds nothing to replay.
    expect((await reconcile(app)).steps.inboundEvents).toMatchObject({ checked: 0 })
  })
})
