import { Schema } from 'effect';

/** Order states (ADR-0009). */
export const OrderState = Schema.Literal(
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
);
export type OrderState = typeof OrderState.Type;

/** What made a Transition happen (CONTEXT.md → Cause). */
export const Cause = Schema.Literal(
  'storefront',
  'stripe_webhook',
  'printful_webhook',
  'cli',
  'reconciliation',
);
export type Cause = typeof Cause.Type;

/** Fulfillment is over: nothing more will ship. Purge eligibility, not "no edges": a refund can still be recorded after `fulfilled`. */
export const TERMINAL: ReadonlySet<OrderState> = new Set([
  'expired',
  'fulfilled',
  'canceled',
  'refunded',
]);

const EDGES: Readonly<Record<OrderState, ReadonlyArray<OrderState>>> = {
  checkout_open: ['expired', 'paid', 'canceled'],
  paid: ['submitted', 'submit_failed', 'canceled', 'refunded'],
  submit_failed: ['submitted', 'canceled'],
  submitted: ['in_production', 'on_hold', 'shipped', 'fulfilled', 'canceled', 'refunded'],
  on_hold: ['submitted', 'in_production', 'canceled', 'refunded'],
  in_production: ['shipped', 'fulfilled', 'on_hold', 'canceled', 'refunded'],
  shipped: ['fulfilled', 'canceled', 'refunded'],
  expired: [],
  // Fulfilled is the end of fulfillment, but a goodwill refund can still be recorded after it.
  fulfilled: ['refunded'],
  canceled: ['refunded'],
  refunded: [],
};

/** The state machine's answer to "may an Order go from A to B?" */
export const canTransition = (from: OrderState, to: OrderState): boolean =>
  EDGES[from].includes(to);
