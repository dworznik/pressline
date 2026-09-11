import { Duration, Effect, Option, Schedule } from 'effect';
import { Config } from '../config/schema';
import { toDecimalString } from '../money';
import {
  FulfilmentProvider,
  type FulfilmentProviderError,
  type ProviderOrder,
} from '../services/fulfilment-provider';
import { attachProviderOrder, findOrder, transition, type Order } from './orders';
import type { Cause } from './state';

/** Backoff for retryable provider errors within one submit attempt. */
export const SUBMIT_RETRY = Schedule.exponential(Duration.millis(100)).pipe(
  Schedule.compose(Schedule.recurs(3)),
);

/** Wall-clock cap on one submit attempt: a webhook handler must answer well within the Inbound Event claim TTL. */
export const SUBMIT_BUDGET = Duration.seconds(20);

export type SubmitOutcome =
  | { readonly outcome: 'submitted'; readonly providerOrderId: string }
  | { readonly outcome: 'already_submitted'; readonly providerOrderId: string }
  | { readonly outcome: 'submit_failed'; readonly reason: string }
  | { readonly outcome: 'retry_later'; readonly reason: string }
  | { readonly outcome: 'skipped'; readonly reason: string };

const CONFIRMED: ReadonlySet<ProviderOrder['status']> = new Set([
  'pending',
  'inreview',
  'onhold',
  'inprocess',
  'partial',
  'fulfilled',
]);

/** Land in submit_failed with the reason on the Transition (and in the log) for the Operator. */
const fail = (
  order: Order,
  cause: Cause,
  ref: string | undefined,
  reason: string,
  providerOrderId?: string,
) =>
  Effect.gen(function* () {
    yield* Effect.logWarning(`order ${order.id}: submit failed: ${reason}`);
    if (order.state === 'submit_failed') {
      // A resubmit that failed again: nothing to move, the reason is logged.
      return { outcome: 'submit_failed', reason } satisfies SubmitOutcome;
    }
    return yield* transition(order.id, 'submit_failed', cause, ref, {
      note: reason,
      ...(providerOrderId ? { providerOrderId } : {}),
    }).pipe(
      Effect.map((): SubmitOutcome => ({ outcome: 'submit_failed', reason })),
      Effect.catchTag('TransitionRefused', () =>
        Effect.succeed<SubmitOutcome>({ outcome: 'skipped', reason: 'state changed' }),
      ),
      Effect.catchTag('OrderNotFound', () =>
        Effect.succeed<SubmitOutcome>({ outcome: 'skipped', reason: 'order vanished' }),
      ),
    );
  });

/** The draft must be for the variant and destination the Customer paid for; anything else is a bug, never confirmed. */
const mismatch = (
  order: Order,
  draft: ProviderOrder,
  catalogVariantId: number,
): string | undefined => {
  if (draft.recipient.countryCode !== order.country) {
    return `provider draft ships to ${draft.recipient.countryCode}, the Order was quoted for ${order.country}`;
  }
  const item = draft.items[0];
  if (!item || item.catalogVariantId !== catalogVariantId) {
    return `provider draft holds variant ${item?.catalogVariantId ?? 'none'}, expected ${catalogVariantId}`;
  }
  if (item.failedPlacement) return `provider rejected the design: ${item.failedPlacement}`;
  return undefined;
};

/**
 * Submit a paid Order to the fulfilment provider (ADR-0009):
 * lookup by external id → draft → check → confirm. Safe to run again after
 * any partial failure: an existing draft is reused, an already confirmed
 * provider order is simply recorded. Retryable provider errors are retried
 * with backoff inside `SUBMIT_BUDGET`; if they persist the Order stays
 * `paid` for Reconciliation. Non-retryable errors and mismatches land in
 * `submit_failed` for the Operator, with the reason on the Transition.
 */
export const submitOrder = (orderId: string, cause: Cause, causeRef?: string) =>
  submitAttempt(orderId, cause, causeRef).pipe(
    Effect.timeoutOption(SUBMIT_BUDGET),
    Effect.map(
      Option.getOrElse((): SubmitOutcome => ({
        outcome: 'retry_later',
        reason: 'submit budget exhausted',
      })),
    ),
  );

const submitAttempt = (orderId: string, cause: Cause, causeRef?: string) =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId);
    if (order.state !== 'paid' && order.state !== 'submit_failed') {
      return { outcome: 'skipped', reason: `state is ${order.state}` } satisfies SubmitOutcome;
    }
    if (!order.recipient) {
      return yield* fail(order, cause, causeRef, 'no Recipient on the Order');
    }
    const config = yield* Config;
    const offer = config.catalogue.offers.find((o) => o.slug === order.offer);
    const catalogVariantId = offer?.variants[order.variant]?.catalogVariantId;
    if (!offer || catalogVariantId === undefined) {
      return yield* fail(
        order,
        cause,
        causeRef,
        `Offer "${order.offer}" / variant "${order.variant}" is no longer configured`,
      );
    }
    const provider = yield* FulfilmentProvider;
    const retrying = <A>(eff: Effect.Effect<A, FulfilmentProviderError>) =>
      eff.pipe(Effect.retry({ schedule: SUBMIT_RETRY, while: (e) => e.retryable }));

    // 1. Lookup by external id: the idempotency step.
    let draft = yield* retrying(provider.findOrderByExternalId(order.id));
    if (draft && CONFIRMED.has(draft.status)) {
      yield* transition(order.id, 'submitted', cause, causeRef, { providerOrderId: draft.id }).pipe(
        Effect.catchTag('TransitionRefused', () => Effect.void),
      );
      return { outcome: 'already_submitted', providerOrderId: draft.id } satisfies SubmitOutcome;
    }
    if (draft && (draft.status === 'failed' || draft.status === 'canceled')) {
      return yield* fail(
        order,
        cause,
        causeRef,
        `provider order ${draft.id} is ${draft.status}`,
        draft.id,
      );
    }

    // 2. Draft.
    if (!draft) {
      draft = yield* retrying(
        provider.createOrderDraft({
          externalId: order.id,
          shippingMethod: order.shippingMethod.id,
          recipient: {
            name: order.recipient.name,
            address1: order.recipient.address1,
            ...(order.recipient.address2 ? { address2: order.recipient.address2 } : {}),
            city: order.recipient.city,
            ...(order.recipient.state ? { stateCode: order.recipient.state } : {}),
            countryCode: order.recipient.country,
            ...(order.recipient.zip ? { zip: order.recipient.zip } : {}),
            email: order.recipient.email,
            ...(order.recipient.phone ? { phone: order.recipient.phone } : {}),
          },
          item: {
            catalogVariantId,
            placement: offer.placement,
            technique: offer.technique,
            printfileUrl: order.printfile.url,
            retailPrice: toDecimalString(order.retail, order.currency),
          },
          currency: order.currency,
        }),
      );
      yield* attachProviderOrder(order.id, draft.id);
    }

    // 3. Check.
    const problem = mismatch(order, draft, catalogVariantId);
    if (problem) return yield* fail(order, cause, causeRef, problem, draft.id);
    if (draft.costs && !draft.costs.calculating) {
      // Compare like with like: the estimate has no tax, so neither does this side.
      const est = order.providerCostEstimate;
      const actual = draft.costs.subtotal + draft.costs.shipping;
      yield* Effect.logInfo(
        `order ${order.id}: provider product+shipping ${actual} ${draft.costs.currency} vs estimate ${est.product + est.shipping} ${est.currency} (delta ${actual - (est.product + est.shipping)})`,
      );
    }

    // 4. Confirm.
    const confirmed = yield* retrying(provider.confirmOrder(draft.id));
    yield* transition(order.id, 'submitted', cause, causeRef, {
      providerOrderId: confirmed.id,
    }).pipe(Effect.catchTag('TransitionRefused', () => Effect.void));
    if (config.demo) {
      // Demo Mode: the provider layer cancelled the draft instead of confirming it; the ledger says so.
      yield* transition(order.id, 'cancelled', cause, causeRef, {
        note: 'Demo Mode: provider draft cancelled instead of confirmed; nothing is produced',
      }).pipe(Effect.catchTag('TransitionRefused', () => Effect.void));
    }
    return { outcome: 'submitted', providerOrderId: confirmed.id } satisfies SubmitOutcome;
  }).pipe(
    Effect.catchTag('FulfilmentProviderError', (e) =>
      Effect.gen(function* () {
        if (e.retryable) {
          yield* Effect.logWarning(
            `order ${orderId}: provider unavailable, will retry later: ${e.message}`,
          );
          return { outcome: 'retry_later', reason: e.message } satisfies SubmitOutcome;
        }
        const order = yield* findOrder(orderId);
        return yield* fail(order, cause, causeRef, e.message, order.providerOrderId);
      }),
    ),
    Effect.catchTag('OrderNotFound', () =>
      Effect.succeed<SubmitOutcome>({ outcome: 'skipped', reason: 'order not found' }),
    ),
  );
