import { StoredInspection } from '@pressline/contract'
import { Clock, Effect, Schema } from 'effect'
import { Db } from '../db/db'
import { InspectionJson } from '../printfile/ensure'
import { statusToken } from './ids'
import { canTransition, Cause, OrderState, TERMINAL } from './state'

/**
 * The Order ledger (ADR-0009): one state row per Order, an append-only
 * Transition per state change with its Cause, written together in one batch
 * (ADR-0008). Reads and writes go through here; nothing else touches the
 * `orders` tables.
 */
export const Recipient = Schema.Struct({
  name: Schema.String,
  address1: Schema.String,
  address2: Schema.optional(Schema.String),
  city: Schema.String,
  state: Schema.optional(Schema.String),
  zip: Schema.optional(Schema.String),
  country: Schema.String,
  email: Schema.String,
  phone: Schema.optional(Schema.String),
})
export type Recipient = typeof Recipient.Type

export const Tracking = Schema.Struct({
  carrier: Schema.optional(Schema.String),
  number: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
})
export type Tracking = typeof Tracking.Type

export const Order = Schema.Struct({
  id: Schema.String,
  state: OrderState,
  statusToken: Schema.String,
  engine: Schema.String,
  designId: Schema.String,
  offer: Schema.String,
  variant: Schema.String,
  specHash: Schema.String,
  printfile: Schema.Struct({
    url: Schema.String,
    sha256: Schema.String,
    contentType: Schema.String,
    /**
     * What Validation saw when this file was accepted, copied here at sale.
     * The Order never re-validates and never joins `printfiles`: a rule that
     * changes later must not rewrite what was sold. Absent on an Order placed
     * before migration 14.
     */
    inspection: Schema.optional(StoredInspection),
  }),
  quoteId: Schema.String,
  currency: Schema.String,
  retail: Schema.Int,
  shipping: Schema.Int,
  shippingMethod: Schema.Struct({ id: Schema.String, name: Schema.String }),
  country: Schema.String,
  providerCostEstimate: Schema.Struct({
    product: Schema.Int,
    shipping: Schema.Int,
    currency: Schema.String,
  }),
  psp: Schema.Struct({
    sessionId: Schema.optional(Schema.String),
    sessionExpiresAt: Schema.optional(Schema.Int),
    paymentIntentId: Schema.optional(Schema.String),
  }),
  amountTax: Schema.optional(Schema.Int),
  amountTotal: Schema.optional(Schema.Int),
  recipient: Schema.optional(Recipient),
  consentAcceptedAt: Schema.optional(Schema.Int),
  providerOrderId: Schema.optional(Schema.String),
  /** Which submission attempt the provider's external id encodes (#77); 0 is the first. */
  providerAttempt: Schema.Int,
  tracking: Schema.optional(Tracking),
  /** Origin the Order was placed on (`https://shop.example`), for links in emails. */
  publicOrigin: Schema.optional(Schema.String),
  /** The design's Preview as hot-linked at checkout (ADR-0003). */
  previewUrl: Schema.optional(Schema.String),
  /** When personal data was purged (ticket #17); the Recipient is gone, country and totals stay. */
  purgedAt: Schema.optional(Schema.Int),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
})
export type Order = typeof Order.Type

export const Transition = Schema.Struct({
  id: Schema.Int,
  orderId: Schema.String,
  from: Schema.NullOr(OrderState),
  to: OrderState,
  cause: Cause,
  causeRef: Schema.optional(Schema.String),
  /** Free text for the Operator, e.g. why a submit failed. */
  note: Schema.optional(Schema.String),
  at: Schema.Int,
})
export type Transition = typeof Transition.Type

export class OrderNotFound extends Schema.TaggedError<OrderNotFound>()('OrderNotFound', {
  id: Schema.String,
}) {}

/** The state machine forbids this move; recorded by the caller, never applied. */
export class TransitionRefused extends Schema.TaggedError<TransitionRefused>()(
  'TransitionRefused',
  { orderId: Schema.String, from: OrderState, to: OrderState },
) {}

type Row = {
  id: string
  state: OrderState
  status_token: string
  engine: string
  design_id: string
  offer_slug: string
  variant_key: string
  spec_hash: string
  printfile_url: string
  printfile_sha256: string
  printfile_content_type: string
  printfile_inspection: string | null
  quote_id: string
  currency: string
  retail: number
  shipping: number
  shipping_method: string
  shipping_method_name: string
  country: string
  cost_product: number
  cost_shipping: number
  cost_currency: string
  psp_session_id: string | null
  psp_session_expires_at: number | null
  psp_payment_intent_id: string | null
  amount_tax: number | null
  amount_total: number | null
  recipient: string | null
  consent_accepted_at: number | null
  provider_order_id: string | null
  provider_attempt: number | null
  tracking: string | null
  public_origin: string | null
  preview_url: string | null
  purged_at: number | null
  created_at: number
  updated_at: number
}

const RecipientJson = Schema.parseJson(Recipient)
const TrackingJson = Schema.parseJson(Tracking)

const fromRow = (r: Row): Effect.Effect<Order> =>
  Effect.gen(function* () {
    const recipient = r.recipient
      ? yield* Schema.decode(RecipientJson)(r.recipient).pipe(Effect.orDie)
      : undefined
    const tracking = r.tracking
      ? yield* Schema.decode(TrackingJson)(r.tracking).pipe(Effect.orDie)
      : undefined
    const inspection = r.printfile_inspection
      ? yield* Schema.decode(InspectionJson)(r.printfile_inspection).pipe(Effect.orDie)
      : undefined
    return {
      id: r.id,
      state: r.state,
      statusToken: r.status_token,
      engine: r.engine,
      designId: r.design_id,
      offer: r.offer_slug,
      variant: r.variant_key,
      specHash: r.spec_hash,
      printfile: {
        url: r.printfile_url,
        sha256: r.printfile_sha256,
        contentType: r.printfile_content_type,
        ...(inspection ? { inspection } : {}),
      },
      quoteId: r.quote_id,
      currency: r.currency,
      retail: r.retail,
      shipping: r.shipping,
      shippingMethod: { id: r.shipping_method, name: r.shipping_method_name },
      country: r.country,
      providerCostEstimate: {
        product: r.cost_product,
        shipping: r.cost_shipping,
        currency: r.cost_currency,
      },
      psp: {
        ...(r.psp_session_id !== null ? { sessionId: r.psp_session_id } : {}),
        ...(r.psp_session_expires_at !== null
          ? { sessionExpiresAt: r.psp_session_expires_at }
          : {}),
        ...(r.psp_payment_intent_id !== null ? { paymentIntentId: r.psp_payment_intent_id } : {}),
      },
      ...(r.amount_tax !== null ? { amountTax: r.amount_tax } : {}),
      ...(r.amount_total !== null ? { amountTotal: r.amount_total } : {}),
      ...(recipient ? { recipient } : {}),
      ...(r.consent_accepted_at !== null ? { consentAcceptedAt: r.consent_accepted_at } : {}),
      ...(r.provider_order_id !== null ? { providerOrderId: r.provider_order_id } : {}),
      providerAttempt: r.provider_attempt ?? 0,
      ...(tracking ? { tracking } : {}),
      ...(r.public_origin !== null ? { publicOrigin: r.public_origin } : {}),
      ...(r.preview_url !== null ? { previewUrl: r.preview_url } : {}),
      ...(r.purged_at !== null ? { purgedAt: r.purged_at } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  })

const SELECT = 'SELECT * FROM orders'

export const findOrder = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db.all<Row>(`${SELECT} WHERE id = ?`, [id]).pipe(Effect.orDie)
    return rows[0] ? yield* fromRow(rows[0]) : yield* new OrderNotFound({ id })
  })

export const findOrderBySession = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .all<Row>(`${SELECT} WHERE psp_session_id = ?`, [sessionId])
      .pipe(Effect.orDie)
    return rows[0] ? yield* fromRow(rows[0]) : undefined
  })

export const findOrderByProviderOrder = (providerOrderId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .all<Row>(`${SELECT} WHERE provider_order_id = ?`, [providerOrderId])
      .pipe(Effect.orDie)
    return rows[0] ? yield* fromRow(rows[0]) : undefined
  })

export const listOrders = (
  options: { state?: OrderState; limit?: number; before?: string; updatedAfter?: number } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const where: string[] = []
    const params: (string | number)[] = []
    if (options.state) {
      where.push('state = ?')
      params.push(options.state)
    }
    if (options.before) {
      where.push('id < ?') // UUIDv7 sorts by creation time
      params.push(options.before)
    }
    if (options.updatedAfter !== undefined) {
      where.push('updated_at > ?')
      params.push(options.updatedAfter)
    }
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`
    const rows = yield* db.all<Row>(sql, [...params, options.limit ?? 100])
    return yield* Effect.forEach(rows, fromRow)
  }).pipe(Effect.orDie)

export const listTransitions = (orderId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db.all<{
      id: number
      order_id: string
      from_state: OrderState | null
      to_state: OrderState
      cause: Cause
      cause_ref: string | null
      note: string | null
      at: number
    }>('SELECT * FROM order_transitions WHERE order_id = ? ORDER BY id', [orderId])
    return rows.map((r): Transition => ({
      id: r.id,
      orderId: r.order_id,
      from: r.from_state,
      to: r.to_state,
      cause: r.cause,
      ...(r.cause_ref !== null ? { causeRef: r.cause_ref } : {}),
      ...(r.note !== null ? { note: r.note } : {}),
      at: r.at,
    }))
  }).pipe(Effect.orDie)

export interface NewOrder {
  readonly id: string
  readonly statusToken: string
  readonly engine: string
  readonly designId: string
  readonly offer: string
  readonly variant: string
  readonly specHash: string
  readonly printfile: {
    url: string
    sha256: string
    contentType: string
    inspection?: StoredInspection
  }
  readonly quoteId: string
  readonly currency: string
  readonly retail: number
  readonly shipping: number
  readonly shippingMethod: { id: string; name: string }
  readonly country: string
  readonly providerCostEstimate: { product: number; shipping: number; currency: string }
  readonly publicOrigin: string
  readonly previewUrl?: string
}

/** Create the Order in `checkout_open` with its first Transition, atomically. */
export const createOrder = (o: NewOrder, causeRef: string, cause: Cause = 'storefront') =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    // The Inspection is copied, not referenced: the Order page reads this
    // snapshot and never joins `printfiles`, so what was sold stays what was sold.
    const inspection = o.printfile.inspection
      ? yield* Schema.encode(InspectionJson)(o.printfile.inspection).pipe(Effect.orDie)
      : null
    yield* db.batch([
      {
        sql: `INSERT INTO orders (id, state, status_token, engine, design_id, offer_slug, variant_key, spec_hash,
                printfile_url, printfile_sha256, printfile_content_type, printfile_inspection, quote_id, currency, retail, shipping,
                shipping_method, shipping_method_name, country, cost_product, cost_shipping, cost_currency,
                public_origin, preview_url, created_at, updated_at)
              VALUES (?, 'checkout_open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          o.id,
          o.statusToken,
          o.engine,
          o.designId,
          o.offer,
          o.variant,
          o.specHash,
          o.printfile.url,
          o.printfile.sha256,
          o.printfile.contentType,
          inspection,
          o.quoteId,
          o.currency,
          o.retail,
          o.shipping,
          o.shippingMethod.id,
          o.shippingMethod.name,
          o.country,
          o.providerCostEstimate.product,
          o.providerCostEstimate.shipping,
          o.providerCostEstimate.currency,
          o.publicOrigin,
          o.previewUrl ?? null,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO order_transitions (order_id, from_state, to_state, cause, cause_ref, at) VALUES (?, NULL, 'checkout_open', ?, ?, ?)`,
        params: [o.id, cause, causeRef, now],
      },
    ])
    return yield* findOrder(o.id)
  }).pipe(Effect.orDie)

/** Attach the PSP session once it exists (the Order is created first so a session can never point at an unknown Order). */
export const attachSession = (orderId: string, sessionId: string, sessionExpiresAt: number) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    yield* db.run(
      'UPDATE orders SET psp_session_id = ?, psp_session_expires_at = ?, updated_at = ? WHERE id = ?',
      [sessionId, sessionExpiresAt, now, orderId],
    )
  }).pipe(Effect.orDie)

/** Issue a new status token (an operator action, ticket #17): old links stop working, the Order ID stays. */
export const rotateStatusToken = (orderId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    const token = statusToken()
    const changed = yield* db.run(
      'UPDATE orders SET status_token = ?, updated_at = ? WHERE id = ?',
      [token, now, orderId],
    )
    if (changed !== 1) return yield* new OrderNotFound({ id: orderId })
    return token
  }).pipe(Effect.catchTag('DbError', (e) => Effect.die(e)))

/** Record the provider's order id as soon as a draft exists, so a re-run finds it even before confirmation. */
export const attachProviderOrder = (orderId: string, providerOrderId: string, attempt = 0) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    // The attempt is stored with the provider order id because it is what the
    // external id encoded (#77): without it a later lookup asks for the wrong one.
    yield* db.run(
      'UPDATE orders SET provider_order_id = ?, provider_attempt = ?, updated_at = ? WHERE id = ?',
      [providerOrderId, attempt, now, orderId],
    )
  }).pipe(Effect.orDie)

/** Column updates that may accompany a Transition (all optional). */
export interface OrderPatch {
  readonly recipient?: Recipient
  readonly consentAcceptedAt?: number
  readonly paymentIntentId?: string
  readonly amountTax?: number
  readonly amountTotal?: number
  readonly providerOrderId?: string
  /** Bumped when a provider-side cancellation forces a fresh external id (#77). */
  readonly providerAttempt?: number
  readonly tracking?: Tracking
  /** Recorded on the Transition, not the Order: why this move happened. */
  readonly note?: string
}

/**
 * Record a fact that moved nothing: a same-state Transition row carrying a
 * note (the provider failing an Order already on hold). Written once per
 * reason, so a repeat of the latest note is a no-op; one INSERT (ADR-0008),
 * conditional on the state read, like `transition`. Answers whether it wrote.
 */
export const annotate = (
  orderId: string,
  cause: Cause,
  causeRef: string | undefined,
  note: string,
) =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId)
    const latest = (yield* listTransitions(orderId)).at(-1)
    if (latest && latest.to === order.state && latest.note === note) return false
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    yield* db
      .run(
        `INSERT INTO order_transitions (order_id, from_state, to_state, cause, cause_ref, note, at)
         SELECT ?, ?, ?, ?, ?, ?, ? FROM orders WHERE id = ? AND state = ?`,
        [
          orderId,
          order.state,
          order.state,
          cause,
          causeRef ?? null,
          note,
          now,
          orderId,
          order.state,
        ],
      )
      .pipe(Effect.orDie)
    return true
  })

/**
 * Move an Order to a new state, recording the Transition and any patch in
 * one batch. Refused (typed) when the state machine forbids the move or when
 * a concurrent writer moved the Order elsewhere first; if that writer made
 * the same move, this call reports success without writing (its patch is
 * dropped: the winner's facts stand).
 */
export const transition = (
  orderId: string,
  to: OrderState,
  cause: Cause,
  causeRef: string | undefined,
  patch: OrderPatch = {},
) =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId)
    if (!canTransition(order.state, to)) {
      return yield* new TransitionRefused({ orderId, from: order.state, to })
    }
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    const sets: string[] = ['state = ?', 'updated_at = ?']
    const params: (string | number)[] = [to, now]
    if (patch.recipient) {
      sets.push('recipient = ?')
      params.push(yield* Schema.encode(RecipientJson)(patch.recipient).pipe(Effect.orDie))
    }
    if (patch.consentAcceptedAt !== undefined) {
      sets.push('consent_accepted_at = ?')
      params.push(patch.consentAcceptedAt)
    }
    if (patch.paymentIntentId !== undefined) {
      sets.push('psp_payment_intent_id = ?')
      params.push(patch.paymentIntentId)
    }
    if (patch.amountTax !== undefined) {
      sets.push('amount_tax = ?')
      params.push(patch.amountTax)
    }
    if (patch.amountTotal !== undefined) {
      sets.push('amount_total = ?')
      params.push(patch.amountTotal)
    }
    if (patch.providerOrderId !== undefined) {
      sets.push('provider_order_id = ?')
      params.push(patch.providerOrderId)
    }
    if (patch.providerAttempt !== undefined) {
      sets.push('provider_attempt = ?')
      params.push(patch.providerAttempt)
    }
    if (patch.tracking) {
      sets.push('tracking = ?')
      params.push(yield* Schema.encode(TrackingJson)(patch.tracking).pipe(Effect.orDie))
    }
    // Both statements are conditional on the state we read, so two racing
    // deliveries cannot both move the row or append a phantom Transition:
    // the loser's INSERT…SELECT matches zero rows and its UPDATE none.
    const changed = yield* db
      .batch([
        {
          sql: `INSERT INTO order_transitions (order_id, from_state, to_state, cause, cause_ref, note, at)
                SELECT ?, ?, ?, ?, ?, ?, ? FROM orders WHERE id = ? AND state = ?`,
          params: [
            orderId,
            order.state,
            to,
            cause,
            causeRef ?? null,
            patch.note ?? null,
            now,
            orderId,
            order.state,
          ],
        },
        {
          sql: `UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND state = ?`,
          params: [...params, orderId, order.state],
        },
      ])
      .pipe(
        Effect.flatMap(() => findOrder(orderId)),
        Effect.map((after) => after.state === to),
        Effect.orDie,
      )
    if (!changed) {
      // Lost the race: whoever won already made (or refused) this move.
      const after = yield* findOrder(orderId)
      if (after.state !== to)
        return yield* new TransitionRefused({ orderId, from: after.state, to })
    }
    return yield* findOrder(orderId)
  })

export const isTerminal = (state: OrderState) => TERMINAL.has(state)

/** Replace the Recipient without moving the Order (the resubmit that follows is the Transition). */
export const updateRecipient = (orderId: string, recipient: Recipient) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    const json = yield* Schema.encode(RecipientJson)(recipient).pipe(Effect.orDie)
    yield* db.run('UPDATE orders SET recipient = ?, updated_at = ? WHERE id = ?', [
      json,
      now,
      orderId,
    ])
  }).pipe(Effect.orDie)

/** Strip Recipient and consent from terminal Orders untouched for longer than `olderThanMs`; returns how many. */
export const purgeOrders = (olderThanMs: number) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = yield* Clock.currentTimeMillis
    const states = [...TERMINAL].map(() => '?').join(', ')
    return yield* db.run(
      `UPDATE orders SET recipient = NULL, consent_accepted_at = NULL, purged_at = ?, updated_at = ?
       WHERE purged_at IS NULL AND updated_at < ? AND state IN (${states})`,
      [now, now, now - olderThanMs, ...TERMINAL],
    )
  }).pipe(Effect.orDie)
