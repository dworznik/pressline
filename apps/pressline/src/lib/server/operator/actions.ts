import { Effect, Schema } from 'effect';
import { Config } from '../config/schema';
import { loadDesign } from '../design/design';
import { sendOrderEmail } from '../emails/send';
import { statusToken, uuidv7 } from '../orders/ids';
import {
  createOrder,
  findOrder,
  purgeOrders,
  Recipient,
  transition,
  updateRecipient,
  type Order,
} from '../orders/orders';
import { submitOrder, type SubmitOutcome } from '../orders/submit';
import { ensurePrintfile } from '../printfile/ensure';
import { makeQuote } from '../quote/quote';
import { FulfilmentProvider } from '../services/fulfilment-provider';
import { Psp } from '../services/psp';
import { toProviderRecipient } from '../orders/recipient';
import { OrderDetail, orderDetail } from './read';

/**
 * Operator order actions (ticket #17): create an Order paid outside the PSP,
 * resubmit, fix the address, cancel, purge personal data. Every state change
 * is a Transition with Cause `cli`; the state machine's refusals surface as
 * `ActionRefused` with the reason, never as a silent no-op.
 */
export class ActionRefused extends Schema.TaggedError<ActionRefused>()('ActionRefused', {
  message: Schema.String,
}) {}

const CAUSE = 'cli' as const;

export const CreateOrderRequest = Schema.Struct({
  engine: Schema.String,
  designId: Schema.String,
  offer: Schema.String,
  variant: Schema.String,
  recipient: Recipient,
  /** v1 creates Orders paid outside the PSP only (reprints, offline sales); the flag makes that explicit. */
  paidOutside: Schema.Literal(true),
  /** Send the Customer the confirmation email as a Storefront order would. */
  email: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});
export type CreateOrderRequest = typeof CreateOrderRequest.Type;

export const ActionResult = Schema.Struct({
  detail: OrderDetail,
  /** What the action did beyond the Transition, for the Operator's eyes. */
  outcome: Schema.String,
});
export type ActionResult = typeof ActionResult.Type;

const describe = (o: SubmitOutcome) =>
  `submit: ${o.outcome}${'reason' in o ? ` (${o.reason})` : ''}${'providerOrderId' in o ? ` provider order ${o.providerOrderId}` : ''}`;

const refuse = (message: string) => new ActionRefused({ message });

/** A webhook or another Operator moved the Order between our read and our write. */
const movedMeanwhile = (e: { readonly _tag: string; readonly from?: string }) =>
  refuse(`${e._tag}: the Order moved to ${e.from ?? '?'} meanwhile; check it and try again`);

/** A manual Order: quote → ensure the Printfile → `checkout_open` → `paid` (outside) → submit. */
export const createManualOrder = (req: CreateOrderRequest) =>
  Effect.gen(function* () {
    const quote = yield* makeQuote({
      engine: req.engine,
      designId: req.designId,
      offer: req.offer,
      variant: req.variant,
      country: req.recipient.country,
      ...(req.recipient.state ? { state: req.recipient.state } : {}),
    }).pipe(Effect.mapError((e) => refuse(e.message)));
    const printfile = yield* ensurePrintfile({
      engine: req.engine,
      designId: req.designId,
      offer: req.offer,
      variant: req.variant,
      wait: true,
    }).pipe(Effect.mapError((e) => refuse(e.message)));
    if (printfile.status !== 'ready') {
      return yield* refuse(
        'the Engine is still rendering the Printfile; run the command again shortly',
      );
    }
    const page = yield* loadDesign(req.engine, req.designId).pipe(
      Effect.mapError((e) => refuse(e.message)),
    );
    const config = yield* Config;
    const id = uuidv7(quote.createdAt);
    yield* createOrder(
      {
        id,
        statusToken: statusToken(),
        engine: quote.engine,
        designId: quote.designId,
        offer: quote.offer,
        variant: quote.variant,
        specHash: quote.specHash,
        printfile: {
          url: printfile.printfile.url,
          sha256: printfile.printfile.sha256,
          contentType: printfile.printfile.contentType,
        },
        quoteId: quote.id,
        currency: quote.currency,
        retail: quote.retail,
        shipping: quote.shipping,
        shippingMethod: { id: quote.shippingMethod.id, name: quote.shippingMethod.name },
        country: quote.country,
        providerCostEstimate: quote.providerCostEstimate,
        publicOrigin: config.checkout.publicUrl ?? '',
        previewUrl: page.design.previewUrl,
      },
      quote.id,
      CAUSE,
    );
    yield* transition(id, 'paid', CAUSE, 'paid_outside', {
      recipient: req.recipient,
      amountTotal: quote.total,
      note: 'paid outside the PSP',
    }).pipe(Effect.orDie);
    const submitted = yield* submitOrder(id, CAUSE, 'paid_outside');
    const mailed = req.email ? yield* sendOrderEmail(id, 'confirmation') : 'not requested';
    return {
      detail: yield* orderDetail(id),
      outcome: `${describe(submitted)}; email: ${mailed}`,
    } satisfies ActionResult;
  });

const mustBe = (order: Order, states: ReadonlyArray<Order['state']>, action: string) =>
  states.includes(order.state)
    ? Effect.void
    : Effect.fail(
        refuse(`cannot ${action} an Order in ${order.state} (needs ${states.join(' or ')})`),
      );

/** From `submit_failed`: submit again. From `on_hold`: confirm the held provider order again. */
export const resubmit = (orderId: string, note = 'resubmitted by the Operator') =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId);
    yield* mustBe(order, ['submit_failed', 'on_hold'], 'resubmit');
    if (order.state === 'on_hold') {
      if (!order.providerOrderId) return yield* refuse('on hold without a provider order id');
      const provider = yield* FulfilmentProvider;
      const confirmed = yield* provider
        .confirmOrder(order.providerOrderId)
        .pipe(Effect.mapError((e) => refuse(`provider refused: ${e.message}`)));
      yield* transition(orderId, 'submitted', CAUSE, order.providerOrderId, { note }).pipe(
        Effect.mapError(movedMeanwhile),
      );
      return {
        detail: yield* orderDetail(orderId),
        outcome: `provider order ${confirmed.id} confirmed again (${confirmed.status})`,
      } satisfies ActionResult;
    }
    const submitted = yield* submitOrder(orderId, CAUSE, note);
    if (submitted.outcome !== 'submitted' && submitted.outcome !== 'already_submitted') {
      return yield* refuse(describe(submitted));
    }
    return {
      detail: yield* orderDetail(orderId),
      outcome: describe(submitted),
    } satisfies ActionResult;
  });

/** Replace the Recipient (same country: the Quote and shipping were made for it), fix it at the provider, resubmit. */
export const fixAddress = (orderId: string, recipient: Recipient) =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId);
    yield* mustBe(order, ['submit_failed', 'on_hold'], 'fix the address of');
    if (recipient.country !== order.country) {
      return yield* refuse(
        `the Order was quoted for ${order.country}; a different country needs a new Order`,
      );
    }
    // Provider first: if it refuses, the ledger is untouched. The new Recipient
    // then rides on the resubmit's Transition, so the change has a Cause.
    if (order.providerOrderId) {
      const provider = yield* FulfilmentProvider;
      yield* provider
        .updateOrderRecipient(order.providerOrderId, toProviderRecipient(recipient))
        .pipe(Effect.mapError((e) => refuse(`provider refused the new address: ${e.message}`)));
    }
    yield* updateRecipient(orderId, recipient);
    return yield* resubmit(orderId, 'address corrected by the Operator');
  });

/** Cancel: at the provider when it still can, then in the ledger. Never refunds. */
export const cancel = (orderId: string) =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId);
    yield* mustBe(
      order,
      [
        'checkout_open',
        'paid',
        'submit_failed',
        'submitted',
        'on_hold',
        'in_production',
        'shipped',
      ],
      'cancel',
    );
    let atProvider = 'no provider order';
    if (order.state === 'checkout_open' && order.psp.sessionId) {
      // A Customer mid-payment must not be able to pay for a cancelled Order.
      const psp = yield* Psp;
      yield* psp
        .expireCheckoutSession(order.psp.sessionId)
        .pipe(
          Effect.mapError((e) =>
            refuse(`PSP: could not expire the checkout session: ${e.message}`),
          ),
        );
      atProvider = 'checkout session expired at the PSP';
    }
    if (order.providerOrderId) {
      const provider = yield* FulfilmentProvider;
      const result = yield* provider
        .cancelOrder(order.providerOrderId)
        .pipe(Effect.mapError((e) => refuse(`provider: ${e.message}`)));
      atProvider =
        result === 'cancelled'
          ? `provider order ${order.providerOrderId} cancelled`
          : `provider order ${order.providerOrderId} is already in production and could not be cancelled through the API; contact the provider`;
    }
    yield* transition(orderId, 'cancelled', CAUSE, order.providerOrderId, {
      note: atProvider,
    }).pipe(Effect.mapError(movedMeanwhile));
    return {
      detail: yield* orderDetail(orderId),
      outcome: `${atProvider}; no refund was made (refund in the PSP dashboard if due)`,
    } satisfies ActionResult;
  });

export const PurgeRequest = Schema.Struct({
  /** Terminal Orders untouched for at least this many days lose their Recipient and consent details. */
  olderThanDays: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
});
export const PurgeResult = Schema.Struct({ purged: Schema.Int });

export const purge = (req: typeof PurgeRequest.Type) =>
  purgeOrders(req.olderThanDays * 24 * 60 * 60 * 1000).pipe(Effect.map((purged) => ({ purged })));
