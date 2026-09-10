import { Effect, Schema } from 'effect';
import type { Db } from '../db/db';
import {
  findOrder,
  findOrderBySession,
  transition,
  type OrderPatch,
  type Recipient,
} from '../orders/orders';
import { Psp, type CheckoutSessionDetails, type PspWebhookEvent } from '../services/psp';
import { receive, settle, type InboundOutcome } from './inbound';

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

const apply = (
  event: PspWebhookEvent,
): Effect.Effect<{ outcome: InboundOutcome; note?: string }, WebhookProcessingFailed, Psp | Db> =>
  Effect.gen(function* () {
    if (
      !event.sessionId ||
      (!PAID_EVENTS.has(event.type) && event.type !== 'checkout.session.expired')
    ) {
      return { outcome: 'ignored', note: event.type };
    }
    const psp = yield* Psp;
    // Re-fetch: the only facts we act on come from Stripe's API, not the delivery.
    const session = yield* psp
      .getCheckoutSession(event.sessionId)
      .pipe(Effect.mapError((e) => new WebhookProcessingFailed({ message: e.message })));
    const order =
      (yield* findOrderBySession(session.id)) ??
      (session.orderId
        ? yield* findOrder(session.orderId).pipe(
            Effect.option,
            Effect.map((o) => (o._tag === 'Some' ? o.value : undefined)),
          )
        : undefined);
    if (!order) return { outcome: 'unknown_order', note: session.id };

    if (event.type === 'checkout.session.expired') {
      return yield* transition(order.id, 'expired', 'stripe_webhook', event.id).pipe(
        Effect.map(() => ({ outcome: 'applied' as const })),
        Effect.catchTag('TransitionRefused', (r) =>
          Effect.succeed({ outcome: 'refused' as const, note: `${r.from}->${r.to}` }),
        ),
        Effect.catchTag('OrderNotFound', () =>
          Effect.succeed({ outcome: 'unknown_order' as const }),
        ),
      );
    }

    if (session.paymentStatus !== 'paid') {
      return { outcome: 'ignored', note: `payment_status=${session.paymentStatus}` };
    }
    const patch: OrderPatch = {
      ...(session.paymentIntentId ? { paymentIntentId: session.paymentIntentId } : {}),
      ...(session.amountTax !== undefined ? { amountTax: session.amountTax } : {}),
      ...(session.amountTotal !== undefined ? { amountTotal: session.amountTotal } : {}),
      ...(session.consentAccepted ? { consentAcceptedAt: event.created * 1000 } : {}),
    };
    const recipient = toRecipient(session);
    return yield* transition(
      order.id,
      'paid',
      'stripe_webhook',
      event.id,
      recipient ? { ...patch, recipient } : patch,
    ).pipe(
      Effect.map(() => ({ outcome: 'applied' as const })),
      Effect.catchTag('TransitionRefused', (r) =>
        Effect.succeed({ outcome: 'refused' as const, note: `${r.from}->${r.to}` }),
      ),
      Effect.catchTag('OrderNotFound', () => Effect.succeed({ outcome: 'unknown_order' as const })),
    );
  });

/** Handle one delivery end to end; the caller has already read the raw body and header. */
export const handleStripeWebhook = (rawBody: string, signature: string | undefined) =>
  Effect.gen(function* () {
    const psp = yield* Psp;
    const event = yield* psp.verifyWebhook(rawBody, signature);
    const state = yield* receive('stripe', event.id, event.type, rawBody);
    if (!state.pending) return { received: true as const, outcome: `duplicate:${state.outcome}` };
    const result = yield* apply(event);
    yield* settle('stripe', event.id, result.outcome, result.note);
    return {
      received: true as const,
      outcome: result.note ? `${result.outcome}:${result.note}` : result.outcome,
    };
  });
