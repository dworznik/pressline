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
  'cancelled',
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

export const TERMINAL: ReadonlySet<OrderState> = new Set([
  'expired',
  'fulfilled',
  'cancelled',
  'refunded',
]);

const EDGES: Readonly<Record<OrderState, ReadonlyArray<OrderState>>> = {
  checkout_open: ['expired', 'paid', 'cancelled'],
  paid: ['submitted', 'submit_failed', 'cancelled', 'refunded'],
  submit_failed: ['submitted', 'cancelled'],
  submitted: ['in_production', 'on_hold', 'shipped', 'fulfilled', 'cancelled'],
  on_hold: ['submitted', 'in_production', 'cancelled'],
  in_production: ['shipped', 'fulfilled', 'on_hold', 'cancelled'],
  shipped: ['fulfilled', 'cancelled'],
  expired: [],
  fulfilled: [],
  cancelled: ['refunded'],
  refunded: [],
};

/** The state machine's answer to "may an Order go from A to B?" */
export const canTransition = (from: OrderState, to: OrderState): boolean =>
  EDGES[from].includes(to);
