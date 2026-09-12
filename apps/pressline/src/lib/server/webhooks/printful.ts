import { Clock, Effect, Schema } from 'effect'
import type { Config } from '../config/schema'
import type { Db } from '../db/db'
import type { DesignSource } from '../services/design-source'
import type { Mailer } from '../services/mailer'
import {
  annotate,
  findOrder,
  findOrderByProviderOrder,
  transition,
  type Order,
  type OrderPatch,
} from '../orders/orders'
import type { Cause, OrderState } from '../orders/state'
import {
  FulfillmentProvider,
  ProviderWebhookRejected,
  type ProviderOrder,
  type ProviderShipment,
  type ProviderWebhookEvent,
} from '../services/fulfillment-provider'
import { sendOrderEmail } from '../emails/send'
import { receive, release, settle, type InboundOutcome } from './inbound'

/**
 * Printful webhook handling (ADR-0007, ADR-0009): verify, record the
 * Inbound Event, re-fetch the provider order (and its shipments for a
 * shipment event), map the provider's status onto the Order state machine
 * and apply the move. The delivery says *which* order changed, never *what*.
 */
export class ProviderWebhookProcessingFailed extends Schema.TaggedError<ProviderWebhookProcessingFailed>()(
  'ProviderWebhookProcessingFailed',
  { message: Schema.String },
) {}

type Result = { readonly outcome: InboundOutcome; readonly note?: string }
const result = (outcome: InboundOutcome, note?: string): Result =>
  note ? { outcome, note } : { outcome }

/** Provider status → the Order state it implies (ADR-0009). `partial` collapses into shipped. */
/** The ledger state a provider status stands for. `from` matters for `failed`: before confirmation it is a failed submission; after it (payment, file) it is the Operator's to sort out, so `on_hold`. */
export const stateFor = (
  status: ProviderOrder['status'],
  from?: OrderState,
): OrderState | undefined => {
  switch (status) {
    case 'pending':
    case 'inreview':
      return 'submitted'
    case 'onhold':
      return 'on_hold'
    case 'inprocess':
      return 'in_production'
    case 'partial':
      return 'shipped'
    case 'fulfilled':
      return 'fulfilled'
    case 'canceled':
      return 'canceled'
    case 'failed':
      return from === 'submitted' || from === 'in_production' || from === 'on_hold'
        ? 'on_hold'
        : 'submit_failed'
    case 'draft':
    case 'unknown':
      return undefined
  }
}

/** What the Operator reads on the Transition when the provider fails a confirmed order. */
export const PROVIDER_FAILED_NOTE =
  'provider reports the order failed (payment or file): fix it at the provider, or cancel'

const recordTransition = (
  order: Order,
  to: OrderState,
  ref: string,
  patch: OrderPatch = {},
  cause: Cause = 'printful_webhook',
) =>
  transition(order.id, to, cause, ref, patch).pipe(
    Effect.flatMap(() =>
      // Shipped email (ticket #12): once, never blocking.
      to === 'shipped' || to === 'fulfilled'
        ? sendOrderEmail(order.id, 'shipped').pipe(
            Effect.map((mailed) => result('applied', `email=${mailed}`)),
          )
        : Effect.succeed(result('applied')),
    ),
    Effect.catchTag('TransitionRefused', (r) =>
      r.from !== to
        ? Effect.succeed(result('refused', `${r.from}->${r.to}`))
        : patch.note
          ? // Same state but a reason worth keeping: a same-state Transition row, once per reason.
            annotate(order.id, cause, ref, patch.note).pipe(
              Effect.map((wrote) => result('applied', wrote ? 'noted' : 'already')),
            )
          : Effect.succeed(result('applied', 'already')),
    ),
    Effect.catchTag('OrderNotFound', () => Effect.succeed(result('unknown_order'))),
  )

const trackingOf = (shipments: ReadonlyArray<ProviderShipment>, preferredId?: string) => {
  const shipped = shipments.filter((s) => s.status === 'shipped')
  const pick = shipped.find((s) => s.id === preferredId) ?? shipped.at(-1)
  if (!pick) return undefined
  return {
    ...(pick.carrier ? { carrier: pick.carrier } : {}),
    ...(pick.trackingNumber ? { number: pick.trackingNumber } : {}),
    ...(pick.trackingUrl ? { url: pick.trackingUrl } : {}),
  }
}

const resolveOrder = (event: ProviderWebhookEvent) =>
  Effect.gen(function* () {
    if (event.orderExternalId) {
      const byId = yield* findOrder(event.orderExternalId).pipe(
        Effect.catchTag('OrderNotFound', () => Effect.succeed(undefined)),
      )
      if (byId) return byId
    }
    return event.providerOrderId
      ? yield* findOrderByProviderOrder(event.providerOrderId)
      : undefined
  })

export const applyPrintfulEvent = (
  event: ProviderWebhookEvent,
  cause: Cause = 'printful_webhook',
): Effect.Effect<
  Result,
  ProviderWebhookProcessingFailed,
  FulfillmentProvider | Db | Config | DesignSource | Mailer
> =>
  Effect.gen(function* () {
    if (!event.providerOrderId) return result('ignored', event.type)
    const order = yield* resolveOrder(event)
    if (!order) return result('unknown_order', event.providerOrderId)
    const provider = yield* FulfillmentProvider
    // Re-fetch: the provider's current status is the fact, not the delivery.
    const fetched = yield* provider.getOrder(event.providerOrderId).pipe(Effect.either)
    if (fetched._tag === 'Left') {
      if (fetched.left.retryable)
        return yield* new ProviderWebhookProcessingFailed({ message: fetched.left.message })
      return result('failed', fetched.left.message)
    }
    const providerOrder = fetched.right
    if (providerOrder.externalId && providerOrder.externalId !== order.id) {
      return result(
        'unknown_order',
        `provider order ${providerOrder.id} belongs to ${providerOrder.externalId}`,
      )
    }
    const target = stateFor(providerOrder.status, order.state)
    if (!target) return result('ignored', `provider status=${providerOrder.status}`)

    let patch: OrderPatch = { providerOrderId: providerOrder.id }
    if (providerOrder.status === 'failed' && target === 'on_hold') {
      patch = { ...patch, note: PROVIDER_FAILED_NOTE }
    }
    const shipmentEvent = event.type.startsWith('shipment_')
    if (shipmentEvent || target === 'shipped' || target === 'fulfilled') {
      // Tracking is part of the fact we are recording, so a transient failure here is retried too.
      const shipments = yield* provider.listShipments(providerOrder.id).pipe(
        Effect.catchIf(
          (e) => e.retryable,
          (e) => new ProviderWebhookProcessingFailed({ message: e.message }),
        ),
        Effect.orElseSucceed(() => [] as ReadonlyArray<ProviderShipment>),
      )
      const tracking = trackingOf(shipments, event.shipmentId)
      if (tracking) patch = { ...patch, tracking }
      // A shipment event for an order the provider still calls in process means a package left: that is shipped.
      if (
        shipmentEvent &&
        event.type === 'shipment_sent' &&
        target === 'in_production' &&
        tracking
      ) {
        return yield* recordTransition(order, 'shipped', event.id, patch, cause)
      }
    }
    return yield* recordTransition(order, target, event.id, patch, cause)
  })

/** Deliveries older than this (or from the future) are rejected: a signed body must not be replayable forever. */
export const MAX_EVENT_AGE_S = 24 * 60 * 60
export const MAX_CLOCK_SKEW_S = 5 * 60

/** Handle one delivery end to end; the caller has already read the raw body and headers. */
export const handlePrintfulWebhook = (
  rawBody: string,
  headers: { signature?: string; publicKey?: string },
) =>
  Effect.gen(function* () {
    const provider = yield* FulfillmentProvider
    const event = yield* provider.verifyWebhook(rawBody, headers)
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
    if (event.occurredAt < now - MAX_EVENT_AGE_S || event.occurredAt > now + MAX_CLOCK_SKEW_S) {
      return yield* new ProviderWebhookRejected({
        message: `event occurred_at ${event.occurredAt} is outside the accepted window`,
      })
    }
    const receipt = yield* receive('printful', event.id, event.type, rawBody)
    if (!receipt.pending) {
      return {
        received: true as const,
        outcome: `duplicate:${receipt.outcome}${receipt.note ? ':' + receipt.note : ''}`,
      }
    }
    const outcome = yield* applyPrintfulEvent(event).pipe(
      Effect.tapError(() => release('printful', event.id)),
    )
    yield* settle('printful', event.id, outcome.outcome, outcome.note)
    return {
      received: true as const,
      outcome: outcome.note ? `${outcome.outcome}:${outcome.note}` : outcome.outcome,
    }
  })
