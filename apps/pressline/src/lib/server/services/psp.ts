import { Context, Schema } from 'effect';
import type { Effect } from 'effect';

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
  readonly orderId: string;
  readonly currency: string;
  readonly product: {
    readonly name: string;
    readonly description?: string;
    readonly imageUrl?: string;
    /** Minor units. */
    readonly amount: number;
  };
  readonly shipping: {
    readonly name: string;
    readonly amount: number;
    readonly minDeliveryDays?: number;
    readonly maxDeliveryDays?: number;
  };
  /** The one country the Quote was made for (ADR-0010). */
  readonly allowedCountry: string;
  /** Withdrawal Notice the Customer must accept before paying. */
  readonly consentText: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Unix seconds. */
  readonly expiresAt: number;
  readonly allowPromotionCodes: boolean;
}

export interface CheckoutSession {
  readonly id: string;
  readonly url: string;
  /** Unix seconds. */
  readonly expiresAt: number;
}

export interface PspService {
  readonly health: () => Effect.Effect<void, PspError>;
  readonly createCheckoutSession: (
    input: CheckoutSessionInput,
  ) => Effect.Effect<CheckoutSession, PspError>;
}

export class Psp extends Context.Tag('pressline/Psp')<Psp, PspService>() {}
