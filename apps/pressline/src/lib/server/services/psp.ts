import { Context, Schema } from 'effect'
import type { Effect } from 'effect'

/**
 * PSP (CONTEXT.md): takes the Customer's money. Stripe Checkout is the only
 * shipped implementation (ADR-0010). Shapes are PSP-neutral; the adapter maps
 * them onto Stripe's Checkout Session. Method set grows per ticket.
 */
export class PspError extends Schema.TaggedError<PspError>()('PspError', {
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optional(Schema.Number),
}) {}

export interface CheckoutSessionInput {
  /** Pressline Order ID; travels as the PSP's client reference and in metadata. */
  readonly orderId: string
  readonly currency: string
  readonly product: {
    readonly name: string
    readonly description?: string
    readonly imageUrl?: string
    /** Minor units. */
    readonly amount: number
  }
  readonly shipping: {
    readonly name: string
    readonly amount: number
    readonly minDeliveryDays?: number
    readonly maxDeliveryDays?: number
  }
  /** The one country the Quote was made for (ADR-0010). */
  readonly allowedCountry: string
  /** Withdrawal Notice the Customer must accept before paying. */
  readonly consentText: string
  readonly successUrl: string
  readonly cancelUrl: string
  /** Unix seconds. */
  readonly expiresAt: number
  readonly allowPromotionCodes: boolean
}

export interface CheckoutSession {
  readonly id: string
  readonly url: string
  /** Unix seconds. */
  readonly expiresAt: number
}

/** A checkout session as re-fetched from the PSP: the only thing a webhook handler may act on. */
export interface CheckoutSessionDetails {
  readonly id: string
  readonly status: 'open' | 'complete' | 'expired'
  readonly paymentStatus: 'paid' | 'unpaid' | 'no_payment_required'
  readonly orderId?: string
  readonly paymentIntentId?: string
  readonly currency?: string
  readonly amountTotal?: number
  readonly amountTax?: number
  readonly consentAccepted: boolean
  readonly customer: { readonly email?: string; readonly name?: string; readonly phone?: string }
  readonly shipping?: {
    readonly name?: string
    readonly address1?: string
    readonly address2?: string
    readonly city?: string
    readonly state?: string
    readonly zip?: string
    readonly country?: string
  }
}

/** A verified webhook delivery, reduced to what the handler needs; the payload itself is never trusted. */
export interface PspWebhookEvent {
  readonly id: string
  readonly type: string
  /** Unix seconds. */
  readonly created: number
  /** The checkout session the event is about, when it is about one. */
  readonly sessionId?: string
}

export class WebhookRejected extends Schema.TaggedError<WebhookRejected>()('WebhookRejected', {
  message: Schema.String,
}) {}

export interface PspWebhookStatus {
  readonly configured: boolean
  readonly url?: string
  readonly detail?: string
}

/** What the PSP says about a payment after the fact (refunds and disputes happen outside Pressline). */
export interface PaymentStatus {
  readonly refunded: boolean
  readonly amountRefunded: number
  readonly disputed: boolean
}

export interface PspService {
  readonly health: () => Effect.Effect<void, PspError>
  readonly getPaymentStatus: (paymentIntentId: string) => Effect.Effect<PaymentStatus, PspError>
  /** Whether a webhook endpoint pointing at Pressline exists on the PSP account. */
  readonly getWebhookStatus: () => Effect.Effect<PspWebhookStatus, PspError>
  readonly createCheckoutSession: (
    input: CheckoutSessionInput,
  ) => Effect.Effect<CheckoutSession, PspError>
  readonly getCheckoutSession: (id: string) => Effect.Effect<CheckoutSessionDetails, PspError>
  /** Verify a raw webhook body against its signature header; rejects forged, unsigned or stale deliveries. */
  readonly verifyWebhook: (
    rawBody: string,
    signature: string | undefined,
  ) => Effect.Effect<PspWebhookEvent, WebhookRejected>
  /** Read an already-verified body again (Reconciliation replays stored Inbound Events). */
  readonly parseWebhook: (rawBody: string) => Effect.Effect<PspWebhookEvent, WebhookRejected>
  /** Close an open hosted checkout so the Customer can no longer pay for it. */
  readonly expireCheckoutSession: (id: string) => Effect.Effect<void, PspError>
  /** Create (or confirm) the webhook endpoint at `url`; the signing secret is only revealed on creation. */
  readonly registerWebhook: (url: string) => Effect.Effect<PspWebhookRegistration, PspError>
}

export interface PspWebhookRegistration {
  readonly status: 'created' | 'verified'
  readonly url: string
  readonly secret?: string
}

export class Psp extends Context.Tag('pressline/Psp')<Psp, PspService>() {}
