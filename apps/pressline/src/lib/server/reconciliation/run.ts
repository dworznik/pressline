import { Clock, Effect, Schema } from 'effect'
import { SESSION_TTL_MS } from '../checkout/checkout'
import { Config } from '../config/schema'
import { Db } from '../db/db'
import { Engines } from '../design/engines'
import { listUnsentEmails, sendOrderEmail } from '../emails/send'
import { catalogCheck } from '../operator/tools'
import { annotate, listOrders, transition, type Order } from '../orders/orders'
import { submitOrder } from '../orders/submit'
import type { DesignSource } from '../services/design-source'
import { FulfillmentProvider } from '../services/fulfillment-provider'
import { Mailer } from '../services/mailer'
import { DISPUTE_CLOSED, isInquiry, Psp, type PaymentDispute } from '../services/psp'
import { listUnprocessed, receive, release, settle, type InboundOutcome } from '../webhooks/inbound'
import { PROVIDER_FAILED_NOTE, applyPrintfulEvent, stateFor } from '../webhooks/printful'
import { applyPaid, applyStripeEvent } from '../webhooks/stripe'

/**
 * Reconciliation (CONTEXT.md, ADR-0009): compare every open Order against
 * the PSP and the fulfillment provider, repair what the webhooks missed
 * (every repair is a Transition with Cause `reconciliation`), record refunds
 * the Operator issued elsewhere, retry failed emails, re-check Engines,
 * refresh the Catalog cache, and raise Alarms for what needs a human.
 * A dry run counts and notes what it would repair, and repairs nothing.
 */
export const Alarm = Schema.Struct({
  kind: Schema.Literal(
    'stuck_paid',
    'submit_failed',
    'on_hold',
    'refund',
    'dispute',
    'engine_disabled',
    'catalog',
    'email',
    'provider_status',
  ),
  orderId: Schema.optional(Schema.String),
  message: Schema.String,
})
export type Alarm = typeof Alarm.Type

export const StepReport = Schema.Struct({
  checked: Schema.Int,
  repaired: Schema.Int,
  notes: Schema.Array(Schema.String),
})

/** `operator` covers the API and the CLI behind it; `cron` the platform schedulers. */
export const Trigger = Schema.Literal('operator', 'cron')
export type Trigger = typeof Trigger.Type

export const ReconciliationReport = Schema.Struct({
  startedAt: Schema.Int,
  finishedAt: Schema.Int,
  trigger: Trigger,
  dryRun: Schema.Boolean,
  steps: Schema.Record({ key: Schema.String, value: StepReport }),
  alarms: Schema.Array(Alarm),
})
export type ReconciliationReport = typeof ReconciliationReport.Type

/**
 * How long a `checkout_open` Order may sit before the sweep asks the PSP about
 * it. The sweep exists to catch a missed `checkout.session.expired`, so it is
 * the session's own life plus a margin for a late webhook — not a number of its
 * own (#152). Change `SESSION_TTL_MS` and this moves with it.
 */
export const CHECKOUT_STALE_MS = SESSION_TTL_MS + 30 * 60_000
export const PAID_STALE_MS = 15 * 60 * 1000
/** How far back the refund scan looks; refunds older than this are the Operator's bookkeeping. */
export const REFUND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
export const EMAIL_MAX_ATTEMPTS = 5
const PAGE = 500

interface Run {
  readonly now: number
  readonly dryRun: boolean
  readonly alarms: Alarm[]
}
interface Step {
  checked: number
  repaired: number
  notes: string[]
}
const step = (): Step => ({ checked: 0, repaired: 0, notes: [] })

const olderThan = (orders: ReadonlyArray<Order>, now: number, ms: number) =>
  orders.filter((o) => now - o.updatedAt > ms)

/** 1. `checkout_open` past its session's life: ask the PSP; paid → settle (missed webhook), else expire. */
const staleCheckouts = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const psp = yield* Psp
    const stale = olderThan(
      yield* listOrders({ state: 'checkout_open', limit: PAGE }),
      run.now,
      CHECKOUT_STALE_MS,
    )
    for (const order of stale) {
      r.checked++
      const sessionId = order.psp.sessionId
      const session = sessionId
        ? yield* psp.getCheckoutSession(sessionId).pipe(Effect.either)
        : undefined
      if (session?._tag === 'Left') {
        r.notes.push(`${order.id}: PSP unavailable (${session.left.message})`)
        continue
      }
      if (session && session.right.paymentStatus !== 'unpaid') {
        r.notes.push(`${order.id}: paid at the PSP but never told us`)
        if (run.dryRun) continue
        yield* applyPaid(
          order,
          session.right,
          {
            id: `reconcile:${sessionId}`,
            type: 'checkout.session.completed',
            created: Math.floor(run.now / 1000),
            sessionId: sessionId!,
          },
          'reconciliation',
        )
        r.repaired++
        continue
      }
      // A `complete` session is a Customer who already committed. A delayed
      // notification method (ACH, SEPA, Boleto, Konbini…) completes the session
      // `unpaid` and settles days later, and `expired` has no outgoing edges, so
      // expiring one here would dead-end an Order that is about to be paid: the
      // settlement is then refused and the money has nowhere to land. Only a
      // session the Customer never completed is this sweep's to expire.
      if (session && session.right.status === 'complete') {
        r.notes.push(`${order.id}: awaiting a delayed payment (session complete, still unpaid)`)
        continue
      }
      if (run.dryRun) {
        r.notes.push(`${order.id}: would expire`)
        continue
      }
      const moved = yield* transition(order.id, 'expired', 'reconciliation', sessionId, {
        note: session ? `session ${session.right.status}` : 'no PSP session',
      }).pipe(Effect.either)
      if (moved._tag === 'Right') r.repaired++
      else r.notes.push(`${order.id}: could not expire (${moved.left._tag})`)
    }
    return r
  })

/** 2. `paid` older than 15 min: submit again; still paid → Alarm. */
const stuckPaid = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const stuck = olderThan(
      yield* listOrders({ state: 'paid', limit: PAGE }),
      run.now,
      PAID_STALE_MS,
    )
    for (const order of stuck) {
      r.checked++
      const age = `paid ${Math.round((run.now - order.updatedAt) / 60000)} min ago`
      if (run.dryRun) {
        r.notes.push(`${order.id}: ${age}, would submit`)
        continue
      }
      const outcome = yield* submitOrder(order.id, 'reconciliation', 'reconcile')
      if (outcome.outcome === 'retry_later' && outcome.rateLimited) {
        // Same reason the catch-up pass stops: the lockout is store-wide, so
        // submitting the rest of the queue into it only holds it open (#153).
        r.checked--
        r.notes.push(
          `rate limited by the provider: pass ended after ${r.checked} of ${stuck.length} stuck Orders, the rest are still paid`,
        )
        run.alarms.push({
          kind: 'provider_status',
          message: `provider rate limit reached: ${stuck.length - r.checked} stuck Order(s) were not resubmitted; the next run continues`,
        })
        break
      }
      if (outcome.outcome === 'submitted' || outcome.outcome === 'already_submitted') r.repaired++
      else
        run.alarms.push({
          kind: 'stuck_paid',
          orderId: order.id,
          message: `${age}, submit: ${outcome.outcome}${'reason' in outcome ? ` (${outcome.reason})` : ''}`,
        })
    }
    return r
  })

/** 3. Provider catch-up for submitted / in_production / on_hold; submit_failed and on_hold are Alarms in themselves. */
const providerCatchUp = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const provider = yield* FulfillmentProvider
    const open = [
      ...(yield* listOrders({ state: 'submitted', limit: PAGE })),
      ...(yield* listOrders({ state: 'in_production', limit: PAGE })),
      ...(yield* listOrders({ state: 'on_hold', limit: PAGE })),
    ]
    for (const order of open) {
      if (!order.providerOrderId) {
        r.checked++
        run.alarms.push({
          kind: 'provider_status',
          orderId: order.id,
          message: `${order.state} without a provider order id`,
        })
        continue
      }
      const fetched = yield* provider.getOrder(order.providerOrderId).pipe(Effect.either)
      if (fetched._tag === 'Left' && fetched.left.status === 429) {
        // The provider's limiter is store-wide and locks us out for a minute, so a
        // pass that keeps walking can fail the submit for a new paid Order. Stop,
        // and say so rather than reporting a half-done pass as a clean one: this
        // step is idempotent and the Orders it never reached are still open (#153).
        r.notes.push(
          `rate limited by the provider: pass ended after ${r.checked} of ${open.length} open Orders, the rest are still open`,
        )
        run.alarms.push({
          kind: 'provider_status',
          message: `provider rate limit reached: the catch-up pass checked ${r.checked} of ${open.length} open Orders and stopped; the next run continues`,
        })
        break
      }
      r.checked++
      if (fetched._tag === 'Left') {
        r.notes.push(`${order.id}: provider unavailable (${fetched.left.message})`)
        continue
      }
      const target = stateFor(fetched.right.status, order.state)
      if (target && target !== order.state) {
        if (run.dryRun) {
          r.notes.push(`${order.id}: would move ${order.state} → ${target}`)
        } else {
          // Same path as a provider webhook (re-fetch, shipped email), recorded with this Cause.
          const outcome = yield* applyPrintfulEvent(
            {
              id: `reconcile:${order.providerOrderId}:${fetched.right.status}`,
              type: 'order_updated',
              occurredAt: 0,
              providerOrderId: order.providerOrderId,
              orderExternalId: order.id,
            },
            'reconciliation',
          ).pipe(Effect.either)
          if (outcome._tag === 'Right' && outcome.right.outcome === 'applied') {
            r.repaired++
            r.notes.push(
              `${order.id}: ${order.state} → ${target} (provider says ${fetched.right.status})`,
            )
          }
        }
      }
      if (fetched.right.status === 'onhold') {
        run.alarms.push({
          kind: 'on_hold',
          orderId: order.id,
          message: 'provider has the order on hold',
        })
      }
      if (fetched.right.status === 'failed') {
        run.alarms.push({ kind: 'on_hold', orderId: order.id, message: PROVIDER_FAILED_NOTE })
      }
    }
    for (const order of yield* listOrders({ state: 'submit_failed', limit: PAGE })) {
      r.checked++
      run.alarms.push({
        kind: 'submit_failed',
        orderId: order.id,
        message: 'submission failed; fix and resubmit',
      })
    }
    return r
  })

/**
 * What the Operator needs from an Alarm about a dispute: whether the money is
 * gone, how much, and whether anything is owed in return. A `warning_*` status
 * is an inquiry — no funds move, but answering it can stop a chargeback.
 */
const disputeMessage = (d: PaymentDispute) => {
  const why = d.reason ? ` (${d.reason})` : ''
  if (isInquiry(d.status)) {
    return `inquiry (${d.status}) for ${d.amount}${why}: no funds withdrawn, but answer it before it becomes a chargeback`
  }
  if (d.status === 'lost') {
    return `dispute lost${why}: ${d.amount} is withdrawn, along with the dispute fee`
  }
  return `chargeback (${d.status}) for ${d.amount}${why}: the funds are withheld until it closes`
}

/**
 * 4. Refunds and disputes seen at the PSP within the refund window. A refund
 * is a fact wherever the Order is (ADR-0009); it is recorded and alarmed once.
 */
const refundsAndDisputes = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const psp = yield* Psp
    const updatedAfter = run.now - REFUND_WINDOW_MS
    const states = [
      'paid',
      'submitted',
      'on_hold',
      'in_production',
      'shipped',
      'fulfilled',
      'canceled',
    ] as const
    const candidates: Order[] = []
    for (const state of states) {
      candidates.push(...(yield* listOrders({ state, limit: PAGE, updatedAfter })))
    }
    candidates.sort((a, b) => a.id.localeCompare(b.id))
    for (const order of candidates) {
      const paymentIntentId = order.psp.paymentIntentId
      if (!paymentIntentId) continue
      r.checked++
      const status = yield* psp.getPaymentStatus(paymentIntentId).pipe(Effect.either)
      if (status._tag === 'Left') {
        r.notes.push(`${order.id}: PSP unavailable (${status.left.message})`)
        continue
      }
      // A dispute walks up to eight states over 2-3 months and ADR-0009 has no Order
      // state for any of them, so it is recorded as a same-state Transition, once per
      // state, and alarmed on the state the ledger has not seen before. A closed
      // dispute is recorded and never alarmed: winning one needs no human (#95).
      const dispute = status.right.dispute
      if (dispute) {
        const note = `dispute ${dispute.status} for ${dispute.amount} at the PSP`
        if (run.dryRun) {
          r.notes.push(`${order.id}: would record ${note}`)
        } else {
          // Scoped to the Order, not its state: the Order keeps moving under a
          // dispute that runs for months, and each move must not re-announce it.
          const recorded = yield* annotate(
            order.id,
            'reconciliation',
            paymentIntentId,
            note,
            'order',
          ).pipe(Effect.orElseSucceed(() => false))
          if (recorded) {
            r.repaired++
            if (!DISPUTE_CLOSED.has(dispute.status)) {
              run.alarms.push({
                kind: 'dispute',
                orderId: order.id,
                message: disputeMessage(dispute),
              })
            }
          }
        }
      }
      // `refunded` is the PSP's "fully refunded" flag and stays false for a partial
      // refund, so the amount is the only signal that money went back (#92).
      const amount = status.right.amountRefunded
      if (amount <= 0) continue
      const captured = order.amountTotal ?? order.retail + order.shipping
      const partial = amount < captured
      if (run.dryRun) {
        r.notes.push(`${order.id}: would record a ${partial ? 'partial ' : ''}refund of ${amount}`)
        continue
      }
      // A partial refund does not make the Order refunded: the goods still ship, and
      // the ledger has one `refunded` state. Record it as a same-state Transition,
      // written once per amount, so a further refund is a new row and an unchanged
      // one is silent (no nightly repeat).
      if (partial) {
        const noted = yield* annotate(
          order.id,
          'reconciliation',
          paymentIntentId,
          `partially refunded ${amount} of ${captured} at the PSP`,
          'order',
        ).pipe(Effect.orElseSucceed(() => false))
        if (noted) {
          r.repaired++
          run.alarms.push({
            kind: 'refund',
            orderId: order.id,
            message: `partial refund of ${amount} of ${captured} recorded; the Order still ships`,
          })
        }
        continue
      }
      const moved = yield* transition(order.id, 'refunded', 'reconciliation', paymentIntentId, {
        note: `refunded ${amount} at the PSP`,
      }).pipe(Effect.either)
      if (moved._tag === 'Right') {
        r.repaired++
        run.alarms.push({
          kind: 'refund',
          orderId: order.id,
          message: `refund of ${amount} recorded${order.state === 'paid' || order.state === 'canceled' ? '' : ` while ${order.state}: cancel it at the provider if it has not shipped`}`,
        })
      } else {
        r.notes.push(`${order.id}: refund seen but not recorded (${moved.left._tag})`)
      }
    }
    return r
  })

/** 5. Inbound Events that were never settled (a crash mid-processing, a lapsed claim). */
const reprocessInbound = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const psp = yield* Psp
    const provider = yield* FulfillmentProvider
    for (const e of yield* listUnprocessed()) {
      r.checked++
      if (run.dryRun) {
        r.notes.push(`${e.provider}/${e.event_id}: would replay`)
        continue
      }
      const claimed = yield* receive(e.provider, e.event_id, e.event_type, e.payload)
      if (!claimed.pending) continue
      const replay: Effect.Effect<
        { readonly outcome: InboundOutcome; readonly note?: string },
        { readonly _tag: string },
        Db | Config | DesignSource | Mailer | FulfillmentProvider | Psp
      > =
        e.provider === 'stripe'
          ? psp.parseWebhook(e.payload).pipe(Effect.flatMap(applyStripeEvent))
          : provider
              .parseWebhook(e.payload)
              .pipe(Effect.flatMap((event) => applyPrintfulEvent(event, 'reconciliation')))
      const outcome = yield* Effect.either(replay)
      if (outcome._tag === 'Right') {
        yield* settle(e.provider, e.event_id, outcome.right.outcome, outcome.right.note)
        r.repaired++
      } else {
        yield* release(e.provider, e.event_id)
        r.notes.push(`${e.provider}/${e.event_id}: still failing (${outcome.left._tag})`)
      }
    }
    return r
  })

/** 6. Emails that failed: retried up to the cap, alarmed every run after it. */
const retryEmails = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    for (const e of yield* listUnsentEmails(Number.MAX_SAFE_INTEGER)) {
      r.checked++
      if (e.attempts >= EMAIL_MAX_ATTEMPTS) {
        run.alarms.push({
          kind: 'email',
          orderId: e.orderId,
          message: `${e.kind} email failed ${e.attempts} times; not retried`,
        })
        continue
      }
      if (run.dryRun) {
        r.notes.push(`${e.orderId}: would resend ${e.kind}`)
        continue
      }
      const outcome = yield* sendOrderEmail(e.orderId, e.kind)
      if (outcome === 'sent' || outcome === 'already_sent') r.repaired++
      else if (e.attempts + 1 >= EMAIL_MAX_ATTEMPTS)
        run.alarms.push({
          kind: 'email',
          orderId: e.orderId,
          message: `${e.kind} email failed ${e.attempts + 1} times`,
        })
    }
    return r
  })

/** 7. Engines: re-check health; a disabled Engine is an Alarm. */
const engineHealth = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const statuses = yield* Effect.flatMap(Engines, (e) => e.refresh)
    for (const s of statuses) {
      r.checked++
      if (!s.enabled)
        run.alarms.push({
          kind: 'engine_disabled',
          message: `engine ${s.slug}: ${s.reason ?? 'disabled'}`,
        })
    }
    return r
  })

/** 8. Catalog: resolve every Offer on its own (refreshing the cache); each one that fails is an Alarm. */
const catalogRefresh = (run: Run) =>
  Effect.gen(function* () {
    const r = step()
    const { offers } = yield* catalogCheck
    for (const o of offers) {
      r.checked++
      if (o.ok) continue
      run.alarms.push({
        kind: 'catalog',
        message: `Offer "${o.slug}": ${o.message ?? 'does not resolve'}`,
      })
    }
    return r
  })

const persist = (report: ReconciliationReport) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.run(
      'INSERT INTO reconciliation_runs (started_at, finished_at, trigger, alarm_count, report) VALUES (?, ?, ?, ?, ?)',
      [
        report.startedAt,
        report.finishedAt,
        report.trigger,
        report.alarms.length,
        JSON.stringify(report),
      ],
    )
  }).pipe(Effect.orDie)

export const latestReport = Effect.gen(function* () {
  const db = yield* Db
  const rows = yield* db.all<{ report: string }>(
    'SELECT report FROM reconciliation_runs ORDER BY id DESC LIMIT 1',
  )
  return rows[0]
    ? yield* Schema.decode(Schema.parseJson(ReconciliationReport))(rows[0].report)
    : undefined
}).pipe(Effect.orDie)

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const alarmEmail = (report: ReconciliationReport) =>
  Effect.gen(function* () {
    const config = yield* Config
    const to = config.email.operator
    if (!to || report.alarms.length === 0) return 'none' as const
    const mailer = yield* Mailer
    const n = report.alarms.length
    const ran = new Date(report.finishedAt).toISOString()
    const line = (a: Alarm) => `${a.orderId ? `${a.orderId}: ` : ''}${a.message}`
    const sent = yield* mailer
      .send({
        to,
        subject: `${config.name}: ${n === 1 ? '1 thing needs' : `${n} things need`} attention`,
        text: [
          `Reconciliation ran at ${ran}.`,
          '',
          ...report.alarms.map((a) => `- [${a.kind}] ${line(a)}`),
        ].join('\n'),
        html: `<p>Reconciliation ran at ${ran}.</p><ul>${report.alarms
          .map((a) => `<li><strong>${a.kind}</strong> ${escapeHtml(line(a))}</li>`)
          .join('')}</ul>`,
        idempotencyKey: `reconciliation:${report.startedAt}`,
      })
      .pipe(Effect.either)
    return sent._tag === 'Right' ? ('sent' as const) : ('failed' as const)
  })

/** Run every step, persist the report, and email the Operator only if there are Alarms. */
export const runReconciliation = (trigger: Trigger, options: { dryRun?: boolean } = {}) =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const run: Run = { now: startedAt, dryRun: options.dryRun ?? false, alarms: [] }
    const steps: Record<string, Step> = {}
    steps.staleCheckouts = yield* staleCheckouts(run)
    steps.stuckPaid = yield* stuckPaid(run)
    steps.providerCatchUp = yield* providerCatchUp(run)
    steps.refundsAndDisputes = yield* refundsAndDisputes(run)
    steps.inboundEvents = yield* reprocessInbound(run)
    steps.emails = yield* retryEmails(run)
    steps.engines = yield* engineHealth(run)
    steps.catalog = yield* catalogRefresh(run)
    const finishedAt = yield* Clock.currentTimeMillis
    const report: ReconciliationReport = {
      startedAt,
      finishedAt,
      trigger,
      dryRun: run.dryRun,
      steps,
      alarms: run.alarms,
    }
    if (run.dryRun) return report
    yield* persist(report)
    const mailed = yield* alarmEmail(report)
    yield* Effect.logInfo(
      `reconciliation (${trigger}): ${run.alarms.length} alarms, email ${mailed}`,
    )
    return report
  })
