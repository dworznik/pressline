import { Effect, Schema } from 'effect';
import { Db } from '../db/db';
import { schemaVersion } from '../db/migrate';
import { migrations } from '../db/migrations';
import { Engines, EngineStatus } from '../design/engines';
import { listOrderEmails, OrderEmail } from '../emails/send';
import { findOrder, listOrders, listTransitions, Order, Transition } from '../orders/orders';
import { OrderState } from '../orders/state';
import { FulfilmentProvider } from '../services/fulfilment-provider';
import { Psp } from '../services/psp';
import { Config } from '../config/schema';

/**
 * Operator read model (ticket #14, ADR-0014): everything the Operator View
 * and the CLI read. Nothing here edits configuration.
 */
export const InboundEventView = Schema.Struct({
  provider: Schema.String,
  eventId: Schema.String,
  eventType: Schema.String,
  receivedAt: Schema.Int,
  processedAt: Schema.optional(Schema.Int),
  outcome: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
});

export const OrderDetail = Schema.Struct({
  order: Order,
  transitions: Schema.Array(Transition),
  inboundEvents: Schema.Array(InboundEventView),
  emails: Schema.Array(OrderEmail),
  links: Schema.Struct({
    stripePayment: Schema.optional(Schema.String),
    stripeSession: Schema.optional(Schema.String),
    printfulOrder: Schema.optional(Schema.String),
  }),
});
export type OrderDetail = typeof OrderDetail.Type;

export const OrderList = Schema.Struct({
  orders: Schema.Array(Order),
  /** Pass back as `before` to get the next page (Orders are listed newest first). */
  nextCursor: Schema.optional(Schema.String),
});

export const OrderListQuery = Schema.Struct({
  state: Schema.optional(OrderState),
  limit: Schema.optionalWith(Schema.NumberFromString.pipe(Schema.int(), Schema.between(1, 200)), {
    default: () => 50,
  }),
  /** Order ID to page from (exclusive), from a previous `nextCursor`. */
  before: Schema.optional(Schema.String),
});

export const WebhookStatus = Schema.Struct({
  stripe: Schema.Struct({
    configured: Schema.Boolean,
    url: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  }),
  printful: Schema.Struct({
    configured: Schema.Boolean,
    url: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  }),
});

export const InstanceHealth = Schema.Struct({
  engines: Schema.Array(EngineStatus),
  webhooks: WebhookStatus,
  config: Schema.Struct({
    name: Schema.String,
    currency: Schema.String,
    offers: Schema.Number,
    demo: Schema.Boolean,
    mailer: Schema.String,
  }),
  schema: Schema.Struct({ version: Schema.Int, latest: Schema.Int }),
  counts: Schema.Record({ key: Schema.String, value: Schema.Int }),
});

/** Deliveries whose event ids appear as Causes on this Order's Transitions. */
const inboundEventsFor = (transitions: ReadonlyArray<Transition>) =>
  Effect.gen(function* () {
    const refs = [...new Set(transitions.map((t) => t.causeRef).filter((r): r is string => !!r))];
    if (refs.length === 0) return [];
    const db = yield* Db;
    const rows = yield* db.all<{
      provider: string;
      event_id: string;
      event_type: string;
      received_at: number;
      processed_at: number | null;
      outcome: string | null;
      note: string | null;
    }>(
      `SELECT provider, event_id, event_type, received_at, processed_at, outcome, note FROM inbound_events
       WHERE event_id IN (${refs.map(() => '?').join(', ')}) ORDER BY received_at`,
      refs,
    );
    return rows.map((r) => ({
      provider: r.provider,
      eventId: r.event_id,
      eventType: r.event_type,
      receivedAt: r.received_at,
      ...(r.processed_at !== null ? { processedAt: r.processed_at } : {}),
      ...(r.outcome !== null ? { outcome: r.outcome } : {}),
      ...(r.note !== null ? { note: r.note } : {}),
    }));
  }).pipe(Effect.orDie);

export const orderDetail = (id: string) =>
  Effect.gen(function* () {
    const order = yield* findOrder(id);
    const transitions = yield* listTransitions(id);
    const inboundEvents = yield* inboundEventsFor(transitions);
    const emails = yield* listOrderEmails(id);
    const config = yield* Config;
    const stripeBase = config.demo
      ? 'https://dashboard.stripe.com/test'
      : 'https://dashboard.stripe.com';
    return {
      order,
      transitions,
      inboundEvents,
      emails,
      links: {
        ...(order.psp.paymentIntentId
          ? { stripePayment: `${stripeBase}/payments/${order.psp.paymentIntentId}` }
          : {}),
        ...(order.psp.sessionId
          ? { stripeSession: `${stripeBase}/checkout/sessions/${order.psp.sessionId}` }
          : {}),
        ...(order.providerOrderId
          ? {
              printfulOrder: `https://www.printful.com/dashboard/default/orders?order_id=${order.providerOrderId}`,
            }
          : {}),
      },
    } satisfies OrderDetail;
  });

export const orderList = (q: typeof OrderListQuery.Type) =>
  Effect.gen(function* () {
    const page = yield* listOrders({
      ...(q.state ? { state: q.state } : {}),
      limit: q.limit + 1,
      ...(q.before ? { before: q.before } : {}),
    });
    const orders = page.slice(0, q.limit);
    return {
      orders,
      ...(page.length > q.limit ? { nextCursor: orders.at(-1)!.id } : {}),
    };
  });

const countsByState = Effect.gen(function* () {
  const db = yield* Db;
  const rows = yield* db.all<{ state: string; n: number }>(
    'SELECT state, COUNT(*) AS n FROM orders GROUP BY state',
  );
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}).pipe(Effect.orDie);

export const instanceHealth = (mailer: string) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const engines = yield* Effect.flatMap(Engines, (e) => e.all);
    const psp = yield* Psp;
    const provider = yield* FulfilmentProvider;
    const stripe = yield* psp.getWebhookStatus().pipe(
      Effect.orElseSucceed(() => ({
        configured: false,
        detail: 'could not read webhook endpoints',
      })),
    );
    const printful = yield* provider.getWebhookStatus().pipe(
      Effect.orElseSucceed(() => ({
        configured: false,
        detail: 'could not read webhook configuration',
      })),
    );
    const version = yield* schemaVersion.pipe(Effect.orDie);
    return {
      engines,
      webhooks: { stripe, printful },
      config: {
        name: config.name,
        currency: config.currency,
        offers: config.catalogue.offers.length,
        demo: config.demo,
        mailer,
      },
      schema: { version, latest: migrations.length },
      counts: yield* countsByState,
    };
  });
