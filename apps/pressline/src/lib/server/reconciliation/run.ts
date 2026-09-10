import { Clock, Effect, Schema } from 'effect';
import { resolveCatalogue } from '../catalogue/catalogue';
import { Config } from '../config/schema';
import { Db } from '../db/db';
import { Engines } from '../design/engines';
import { listUnsentEmails, sendOrderEmail } from '../emails/send';
import { listOrders, transition, type Order } from '../orders/orders';
import { submitOrder } from '../orders/submit';
import { FulfilmentProvider } from '../services/fulfilment-provider';
import { Mailer } from '../services/mailer';
import { Psp } from '../services/psp';
import {
  receive,
  listUnprocessed,
  release,
  settle,
  type InboundOutcome,
} from '../webhooks/inbound';
import type { DesignSource } from '../services/design-source';
import { applyPrintfulEvent, stateFor } from '../webhooks/printful';
import { applyPaid, applyStripeEvent } from '../webhooks/stripe';

/**
 * Reconciliation (CONTEXT.md, ADR-0009): compare every open Order against
 * the PSP and the fulfilment provider, repair what the webhooks missed
 * (every repair is a Transition with Cause `reconciliation`), record refunds
 * the Operator issued elsewhere, retry failed emails, re-check Engines,
 * refresh the Catalogue cache, and raise Alarms for what needs a human.
 */
export const Alarm = Schema.Struct({
  kind: Schema.Literal(
    'stuck_paid',
    'submit_failed',
    'on_hold',
    'refund',
    'dispute',
    'engine_disabled',
    'catalogue',
    'email',
    'provider_status',
  ),
  orderId: Schema.optional(Schema.String),
  message: Schema.String,
});
export type Alarm = typeof Alarm.Type;

export const StepReport = Schema.Struct({
  checked: Schema.Int,
  repaired: Schema.Int,
  notes: Schema.Array(Schema.String),
});

export const ReconciliationReport = Schema.Struct({
  startedAt: Schema.Int,
  finishedAt: Schema.Int,
  trigger: Schema.String,
  steps: Schema.Record({ key: Schema.String, value: StepReport }),
  alarms: Schema.Array(Alarm),
});
export type ReconciliationReport = typeof ReconciliationReport.Type;

export const CHECKOUT_STALE_MS = 24 * 60 * 60 * 1000;
export const PAID_STALE_MS = 15 * 60 * 1000;

type Step = { checked: number; repaired: number; notes: string[] };
const step = (): Step => ({ checked: 0, repaired: 0, notes: [] });

const olderThan = (orders: ReadonlyArray<Order>, now: number, ms: number) =>
  orders.filter((o) => now - o.updatedAt > ms);

/** 1. `checkout_open` older than 24h: ask the PSP; paid → settle (missed webhook), else expire. */
const staleCheckouts = (now: number) =>
  Effect.gen(function* () {
    const r = step();
    const psp = yield* Psp;
    for (const order of olderThan(
      yield* listOrders({ state: 'checkout_open', limit: 500 }),
      now,
      CHECKOUT_STALE_MS,
    )) {
      r.checked++;
      const sessionId = order.psp.sessionId;
      if (!sessionId) {
        yield* transition(order.id, 'expired', 'reconciliation', undefined, {
          note: 'no PSP session',
        }).pipe(Effect.ignore);
        r.repaired++;
        continue;
      }
      const session = yield* psp.getCheckoutSession(sessionId).pipe(Effect.either);
      if (session._tag === 'Left') {
        r.notes.push(`${order.id}: PSP unavailable (${session.left.message})`);
        continue;
      }
      if (session.right.paymentStatus !== 'unpaid') {
        const ref = `reconcile:${sessionId}`;
        yield* applyPaid(
          order,
          session.right,
          {
            id: ref,
            type: 'checkout.session.completed',
            created: Math.floor(now / 1000),
            sessionId,
          },
          'reconciliation',
        );
        r.repaired++;
        r.notes.push(`${order.id}: paid at the PSP but never told us; settled`);
      } else {
        yield* transition(order.id, 'expired', 'reconciliation', sessionId, {
          note: `session ${session.right.status}`,
        }).pipe(Effect.ignore);
        r.repaired++;
      }
    }
    return r;
  });

/** 2. `paid` older than 15 min: submit again; still paid → Alarm. */
const stuckPaid = (now: number, alarms: Alarm[]) =>
  Effect.gen(function* () {
    const r = step();
    for (const order of olderThan(
      yield* listOrders({ state: 'paid', limit: 500 }),
      now,
      PAID_STALE_MS,
    )) {
      r.checked++;
      const outcome = yield* submitOrder(order.id, 'reconciliation', 'reconcile');
      if (outcome.outcome === 'submitted' || outcome.outcome === 'already_submitted') r.repaired++;
      else
        alarms.push({
          kind: 'stuck_paid',
          orderId: order.id,
          message: `paid ${Math.round((now - order.updatedAt) / 60000)} min ago, submit: ${outcome.outcome}${'reason' in outcome ? ` (${outcome.reason})` : ''}`,
        });
    }
    return r;
  });

/** 3. Provider catch-up for submitted / in_production / on_hold; submit_failed and on_hold are Alarms in themselves. */
const providerCatchUp = (alarms: Alarm[]) =>
  Effect.gen(function* () {
    const r = step();
    const provider = yield* FulfilmentProvider;
    const open = [
      ...(yield* listOrders({ state: 'submitted', limit: 500 })),
      ...(yield* listOrders({ state: 'in_production', limit: 500 })),
      ...(yield* listOrders({ state: 'on_hold', limit: 500 })),
    ];
    for (const order of open) {
      r.checked++;
      if (!order.providerOrderId) {
        alarms.push({
          kind: 'provider_status',
          orderId: order.id,
          message: `${order.state} without a provider order id`,
        });
        continue;
      }
      const fetched = yield* provider.getOrder(order.providerOrderId).pipe(Effect.either);
      if (fetched._tag === 'Left') {
        r.notes.push(`${order.id}: provider unavailable (${fetched.left.message})`);
        continue;
      }
      const target = stateFor(fetched.right.status);
      if (target && target !== order.state) {
        // Same path as a provider webhook, with the reconciliation Cause recorded via the event id.
        const outcome = yield* applyPrintfulEvent({
          id: `reconcile:${order.providerOrderId}:${fetched.right.status}`,
          type: 'order_updated',
          occurredAt: 0,
          providerOrderId: order.providerOrderId,
          orderExternalId: order.id,
        }).pipe(Effect.either);
        if (outcome._tag === 'Right' && outcome.right.outcome === 'applied') {
          r.repaired++;
          r.notes.push(
            `${order.id}: ${order.state} → ${target} (provider says ${fetched.right.status})`,
          );
        }
      }
      if (fetched.right.status === 'onhold') {
        alarms.push({
          kind: 'on_hold',
          orderId: order.id,
          message: 'provider has the order on hold',
        });
      }
    }
    for (const order of yield* listOrders({ state: 'submit_failed', limit: 500 })) {
      alarms.push({
        kind: 'submit_failed',
        orderId: order.id,
        message: 'submission failed; fix and resubmit',
      });
    }
    return r;
  });

/**
 * 4. Refunds and disputes seen at the PSP. `refunded` is reachable from
 * `paid` and `cancelled` only (ADR-0009): a refund on an Order the provider
 * already has is an Alarm for the Operator to cancel first, not a repair.
 */
const refundsAndDisputes = (alarms: Alarm[]) =>
  Effect.gen(function* () {
    const r = step();
    const psp = yield* Psp;
    const candidates = [
      ...(yield* listOrders({ state: 'paid', limit: 500 })),
      ...(yield* listOrders({ state: 'submitted', limit: 500 })),
      ...(yield* listOrders({ state: 'in_production', limit: 500 })),
      ...(yield* listOrders({ state: 'shipped', limit: 500 })),
      ...(yield* listOrders({ state: 'fulfilled', limit: 500 })),
      ...(yield* listOrders({ state: 'cancelled', limit: 500 })),
    ]
      .filter((o) => o.psp.paymentIntentId)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const order of candidates) {
      r.checked++;
      const status = yield* psp.getPaymentStatus(order.psp.paymentIntentId!).pipe(Effect.either);
      if (status._tag === 'Left') {
        r.notes.push(`${order.id}: PSP unavailable (${status.left.message})`);
        continue;
      }
      if (status.right.disputed) {
        alarms.push({
          kind: 'dispute',
          orderId: order.id,
          message: 'payment is disputed at the PSP',
        });
      }
      if (status.right.refunded) {
        const moved = yield* transition(
          order.id,
          'refunded',
          'reconciliation',
          order.psp.paymentIntentId,
          {
            note: `refunded ${status.right.amountRefunded} at the PSP`,
          },
        ).pipe(Effect.either);
        if (moved._tag === 'Right') r.repaired++;
        alarms.push({
          kind: 'refund',
          orderId: order.id,
          message:
            moved._tag === 'Right'
              ? `refund of ${status.right.amountRefunded} recorded`
              : `refund of ${status.right.amountRefunded} seen while ${order.state}; not recorded (state machine)`,
        });
      }
    }
    return r;
  });

/** 5. Inbound Events that were never settled (a crash mid-processing, a lapsed claim). */
const reprocessInbound = () =>
  Effect.gen(function* () {
    const r = step();
    const psp = yield* Psp;
    const provider = yield* FulfilmentProvider;
    for (const e of yield* listUnprocessed()) {
      r.checked++;
      const claimed = yield* receive(e.provider, e.event_id, e.event_type, e.payload);
      if (!claimed.pending) continue;
      const replay: Effect.Effect<
        { readonly outcome: InboundOutcome; readonly note?: string },
        { readonly _tag: string },
        Db | Config | DesignSource | Mailer | FulfilmentProvider | Psp
      > =
        e.provider === 'stripe'
          ? psp.parseWebhook(e.payload).pipe(Effect.flatMap(applyStripeEvent))
          : provider.parseWebhook(e.payload).pipe(Effect.flatMap(applyPrintfulEvent));
      const outcome = yield* Effect.either(replay);
      if (outcome._tag === 'Right') {
        yield* settle(e.provider, e.event_id, outcome.right.outcome, outcome.right.note);
        r.repaired++;
      } else {
        yield* release(e.provider, e.event_id);
        r.notes.push(`${e.provider}/${e.event_id}: still failing (${outcome.left._tag})`);
      }
    }
    return r;
  });

/** 6. Emails that failed. */
const retryEmails = (alarms: Alarm[]) =>
  Effect.gen(function* () {
    const r = step();
    for (const e of yield* listUnsentEmails()) {
      r.checked++;
      const outcome = yield* sendOrderEmail(e.orderId, e.kind);
      if (outcome === 'sent' || outcome === 'already_sent') r.repaired++;
      else if (e.attempts + 1 >= 5)
        alarms.push({
          kind: 'email',
          orderId: e.orderId,
          message: `${e.kind} email failed ${e.attempts + 1} times`,
        });
    }
    return r;
  });

/** 7. Engines. */
const engineHealth = (alarms: Alarm[]) =>
  Effect.gen(function* () {
    const r = step();
    const statuses = yield* Effect.flatMap(Engines, (e) => e.refresh);
    for (const s of statuses) {
      r.checked++;
      if (!s.enabled)
        alarms.push({
          kind: 'engine_disabled',
          message: `engine ${s.slug}: ${s.reason ?? 'disabled'}`,
        });
    }
    return r;
  });

/** 8. Catalogue cache. */
const catalogueRefresh = (alarms: Alarm[]) =>
  Effect.gen(function* () {
    const r = step();
    const result = yield* resolveCatalogue.pipe(Effect.either);
    r.checked = 1;
    if (result._tag === 'Left') alarms.push({ kind: 'catalogue', message: result.left.message });
    else r.notes.push(`${result.right.offers.length} offers resolved`);
    return r;
  });

const persist = (report: ReconciliationReport) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.run(
      'INSERT INTO reconciliation_runs (started_at, finished_at, trigger, alarm_count, report) VALUES (?, ?, ?, ?, ?)',
      [
        report.startedAt,
        report.finishedAt,
        report.trigger,
        report.alarms.length,
        JSON.stringify(report),
      ],
    );
  }).pipe(Effect.orDie);

export const latestReport = Effect.gen(function* () {
  const db = yield* Db;
  const rows = yield* db.all<{ report: string }>(
    'SELECT report FROM reconciliation_runs ORDER BY id DESC LIMIT 1',
  );
  return rows[0]
    ? yield* Schema.decode(Schema.parseJson(ReconciliationReport))(rows[0].report)
    : undefined;
}).pipe(Effect.orDie);

const alarmEmail = (report: ReconciliationReport) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const to = config.email.operator;
    if (!to || report.alarms.length === 0) return 'none' as const;
    const mailer = yield* Mailer;
    const lines = report.alarms.map(
      (a) => `- [${a.kind}] ${a.orderId ? `${a.orderId}: ` : ''}${a.message}`,
    );
    const sent = yield* mailer
      .send({
        to,
        subject: `${config.name}: ${report.alarms.length === 1 ? '1 thing needs' : `${report.alarms.length} things need`} attention`,
        text: [
          `Reconciliation ran at ${new Date(report.finishedAt).toISOString()}.`,
          '',
          ...lines,
        ].join('\n'),
        html: `<p>Reconciliation ran at ${new Date(report.finishedAt).toISOString()}.</p><ul>${report.alarms
          .map(
            (a) =>
              `<li><strong>${a.kind}</strong>${a.orderId ? ` <code>${a.orderId}</code>` : ''}: ${a.message.replaceAll('<', '&lt;')}</li>`,
          )
          .join('')}</ul>`,
        idempotencyKey: `reconciliation:${report.startedAt}`,
      })
      .pipe(Effect.either);
    return sent._tag === 'Right' ? ('sent' as const) : ('failed' as const);
  });

/** Run every step, persist the report, and email the Operator only if there are Alarms. */
export const runReconciliation = (trigger: string) =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const alarms: Alarm[] = [];
    const steps: Record<string, Step> = {};
    steps.staleCheckouts = yield* staleCheckouts(startedAt);
    steps.stuckPaid = yield* stuckPaid(startedAt, alarms);
    steps.providerCatchUp = yield* providerCatchUp(alarms);
    steps.refundsAndDisputes = yield* refundsAndDisputes(alarms);
    steps.inboundEvents = yield* reprocessInbound();
    steps.emails = yield* retryEmails(alarms);
    steps.engines = yield* engineHealth(alarms);
    steps.catalogue = yield* catalogueRefresh(alarms);
    const finishedAt = yield* Clock.currentTimeMillis;
    const report: ReconciliationReport = { startedAt, finishedAt, trigger, steps, alarms };
    yield* persist(report);
    const mailed = yield* alarmEmail(report);
    yield* Effect.logInfo(`reconciliation (${trigger}): ${alarms.length} alarms, email ${mailed}`);
    return report;
  });
