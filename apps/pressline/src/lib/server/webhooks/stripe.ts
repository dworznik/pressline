import { Effect, Schema } from 'effect';
import type { Config } from '../config/schema';
import type { Db } from '../db/db';
import type { DesignSource } from '../services/design-source';
import type { FulfilmentProvider } from '../services/fulfilment-provider';
import type { Mailer } from '../services/mailer';
import {
  findOrder,
  findOrderBySession,
  transition,
  type Order,
  type OrderPatch,
  type Recipient,
} from '../orders/orders';
import type { Cause, OrderState } from '../orders/state';
import { submitOrder } from '../orders/submit';
import { sendOrderEmail } from '../emails/send';
import { Psp, type CheckoutSessionDetails, type PspWebhookEvent } from '../services/psp';
import { receive, release, settle, type InboundOutcome } from './inbound';

/**
 * Stripe webhook handling (ADR-0007, ADR-0009): verify, record the Inbound
 * Event, re-fetch the session from Stripe and only then move the Order.
 * The webhook body is a hint about *which* session changed, never the truth.
 */
export const WebhookAck = Schema.Struct({
  received: Schema.Literal(true),
  outcome: Schema.String,
});

/** The processing failed in a way Stripe should retry (500). */
export class WebhookProcessingFailed extends Schema.TaggedError<WebhookProcessingFailed>()(
  'WebhookProcessingFailed',
  { message: Schema.String },
) {}

type Result = { readonly outcome: InboundOutcome; readonly note?: string };
const result = (outcome: InboundOutcome, note?: string): Result =>
  note ? { outcome, note } : { outcome };

const toRecipient = (s: CheckoutSessionDetails): Recipient | undefined => {
  const ship = s.shipping;
  const name = ship?.name ?? s.customer.name;
  if (!ship?.address1 || !ship.city || !ship.country || !name || !s.customer.email)
    return undefined;
  return {
    name,
    address1: ship.address1,
    ...(ship.address2 ? { address2: ship.address2 } : {}),
    city: ship.city,
    ...(ship.state ? { state: ship.state } : {}),
    ...(ship.zip ? { zip: ship.zip } : {}),
    country: ship.country,
    email: s.customer.email,
    ...(s.customer.phone ? { phone: s.customer.phone } : {}),
  };
};

const PAID_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);
const HANDLED = new Set([...PAID_EVENTS, 'checkout.session.expired']);

/** Apply a move, treating "already there" as applied (a replay after a crash) and a forbidden move as refused. */
const recordTransition = (
  order: Order,
  to: OrderState,
  ref: string,
  patch: OrderPatch = {},
  cause: Cause = 'stripe_webhook',
) =>
  transition(order.id, to, cause, ref, patch).pipe(
    Effect.map(() => result('applied')),
    Effect.catchTag('TransitionRefused', (r) =>
      Effect.succeed(
        r.from === to ? result('applied', 'already') : result('refused', `${r.from}->${r.to}`),
      ),
    ),
    Effect.catchTag('OrderNotFound', () => Effect.succeed(result('unknown_order'))),
  );

/** The Order a session belongs to: by the stored session id, else by the client reference Stripe echoes. */
const resolveOrder = (session: CheckoutSessionDetails) =>
  Effect.gen(function* () {
    const bySession = yield* findOrderBySession(session.id);
    if (bySession) return bySession;
    if (!session.orderId) return undefined;
    return yield* findOrder(session.orderId).pipe(
      Effect.catchTag('OrderNotFound', () => Effect.succeed(undefined)),
    );
  });

const applyExpired = (order: Order, session: CheckoutSessionDetails, event: PspWebhookEvent) =>
  session.status === 'expired'
    ? recordTransition(order, 'expired', event.id)
    : Effect.succeed(result('ignored', `session status=${session.status}`));

/** Settle a session the PSP reports as paid onto its Order: used by the webhook and by Reconciliation. */
export const applyPaid = (
  order: Order,
  session: CheckoutSessionDetails,
  event: PspWebhookEvent,
  cause: Cause = 'stripe_webhook',
) =>
  Effect.gen(function* () {
    // `no_payment_required` is a fully discounted session: nothing to collect, still an order.
    if (session.paymentStatus === 'unpaid') return result('ignored', 'payment_status=unpaid');
    const recipient = toRecipient(session);
    const patch: OrderPatch = {
      ...(session.paymentIntentId ? { paymentIntentId: session.paymentIntentId } : {}),
      ...(session.amountTax !== undefined ? { amountTax: session.amountTax } : {}),
      ...(session.amountTotal !== undefined ? { amountTotal: session.amountTotal } : {}),
      // Stripe records acceptance but not when; the completion event is the closest timestamp.
      ...(session.consentAccepted ? { consentAcceptedAt: event.created * 1000 } : {}),
      ...(recipient ? { recipient } : {}),
    };
    const moved = yield* recordTransition(order, 'paid', event.id, patch, cause);
    const notes: string[] = [];
    if (moved.note) notes.push(moved.note);
    if (!recipient) notes.push('no_recipient');
    if (!session.consentAccepted) notes.push('no_consent');
    if (moved.outcome !== 'applied') return moved;
    // Paid → submit to the provider (ticket #10). Also runs on a replay that
    // found the Order already paid, so a redelivery retries a submission that
    // failed transiently. Its result never fails the webhook.
    const submitted = yield* submitOrder(order.id, cause, event.id);
    notes.push(`submit=${submitted.outcome}`);
    // Confirmation email (ticket #12): once, never blocking; failures are retried by Reconciliation.
    const mailed = yield* sendOrderEmail(order.id, 'confirmation');
    notes.push(`email=${mailed}`);
    return result('applied', notes.join(','));
  });

export const applyStripeEvent = (
  event: PspWebhookEvent,
): Effect.Effect<
  Result,
  WebhookProcessingFailed,
  Psp | Db | Config | FulfilmentProvider | DesignSource | Mailer
> =>
  Effect.gen(function* () {
    if (!event.sessionId || !HANDLED.has(event.type)) return result('ignored', event.type);
    const psp = yield* Psp;
    // Re-fetch: the only facts we act on come from Stripe's API, not the delivery.
    const fetched = yield* psp.getCheckoutSession(event.sessionId).pipe(Effect.either);
    if (fetched._tag === 'Left') {
      // Transient → 500 so Stripe retries; anything else (gone, misconfigured key) will not improve by retrying.
      if (fetched.left.retryable)
        return yield* new WebhookProcessingFailed({ message: fetched.left.message });
      return result('failed', fetched.left.message);
    }
    const session = fetched.right;
    const order = yield* resolveOrder(session);
    if (!order) return result('unknown_order', session.id);
    return event.type === 'checkout.session.expired'
      ? yield* applyExpired(order, session, event)
      : yield* applyPaid(order, session, event);
  });

/** Handle one delivery end to end; the caller has already read the raw body and header. */
export const handleStripeWebhook = (rawBody: string, signature: string | undefined) =>
  Effect.gen(function* () {
    const psp = yield* Psp;
    const event = yield* psp.verifyWebhook(rawBody, signature);
    const receipt = yield* receive('stripe', event.id, event.type, rawBody);
    if (!receipt.pending) {
      return {
        received: true as const,
        outcome: `duplicate:${receipt.outcome}${receipt.note ? ':' + receipt.note : ''}`,
      };
    }
    const outcome = yield* applyStripeEvent(event).pipe(
      // Not settled: the claim lapses and Stripe's retry is processed again.
      Effect.tapError(() => release('stripe', event.id)),
    );
    yield* settle('stripe', event.id, outcome.outcome, outcome.note);
    return {
      received: true as const,
      outcome: outcome.note ? `${outcome.outcome}:${outcome.note}` : outcome.outcome,
    };
  });
