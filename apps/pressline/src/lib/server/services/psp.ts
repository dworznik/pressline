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

/**
 * Where a dispute stands. A `warning_*` status is an inquiry: it withdraws no
 * funds and may close without ever becoming a chargeback. The rest are a real
 * chargeback, which withdraws the amount plus the dispute fee until it closes.
 * The lifecycle runs 2-3 months and can even move from `lost` back to `won`.
 * `unknown` is a status this adapter does not recognize; it is never terminal.
 */
export const DISPUTE_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented',
] as const

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number] | 'unknown'

/** Whether the PSP names a status this adapter knows; anything else reads as `unknown`. */
export const isDisputeStatus = (s: string): s is DisputeStatus =>
  (DISPUTE_STATUSES as ReadonlyArray<string>).includes(s)

/** A dispute has closed and asks nothing further of the Operator. */
export const DISPUTE_CLOSED: ReadonlySet<DisputeStatus> = new Set<DisputeStatus>([
  'won',
  'warning_closed',
  'prevented',
])

/**
 * An inquiry (Stripe's `warning_*`): the Customer's bank is asking, no funds
 * have moved, and answering it can stop a chargeback from ever opening.
 */
export const isInquiry = (status: DisputeStatus) => status.startsWith('warning_')

export interface PaymentDispute {
  readonly status: DisputeStatus
  /** Minor units under dispute, in the payment's currency. */
  readonly amount: number
  /** The PSP's reason code, when it names one (`fraudulent`, `product_not_received`, …). */
  readonly reason?: string
}

/** What the PSP says about a payment after the fact (refunds and disputes happen outside Pressline). */
export interface PaymentStatus {
  readonly refunded: boolean
  readonly amountRefunded: number
  /** Present once the PSP knows of a dispute, and it stays present after the dispute closes. */
  readonly dispute?: PaymentDispute
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
