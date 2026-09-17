import { Context, Schema } from 'effect'
import type { Effect } from 'effect'

/**
 * Fulfillment Provider (CONTEXT.md): prints and ships. Printful v2 is the only
 * shipped implementation (ADR-0007). Shapes here are provider-neutral; the
 * adapter maps Printful's wire format onto them. Method set grows per ticket.
 */
export class FulfillmentProviderError extends Schema.TaggedError<FulfillmentProviderError>()(
  'FulfillmentProviderError',
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    status: Schema.optional(Schema.Number),
    /**
     * How long the provider asked us to wait (its `retry-after`), when it named
     * one. A caller that retries obeys this in place of its own backoff: the
     * limiter locks the store out for a fixed minute, so guessing is worse than
     * waiting the time the provider gave (ADR-0007, #98).
     */
    retryAfterMs: Schema.optional(Schema.Number),
  },
) {}

/** A (placement, technique) pair: how a product can be printed. */
export interface PrintMethod {
  readonly placement: string
  readonly technique: string
}

export const samePrintMethod = (a: PrintMethod, b: PrintMethod) =>
  a.placement === b.placement && a.technique === b.technique

export interface CatalogProduct {
  readonly id: number
  readonly name: string
  readonly printMethods: ReadonlyArray<PrintMethod>
}

export interface CatalogVariant {
  readonly id: number
  readonly catalogProductId: number
  readonly name: string
  readonly size?: string
  readonly color?: string
  readonly imageUrl?: string
  /** Print area per placement, in inches. */
  readonly placementDimensions: ReadonlyArray<{
    readonly placement: string
    readonly widthIn: number
    readonly heightIn: number
    readonly orientation: string
  }>
}

export interface PlacementPrintArea extends PrintMethod {
  readonly printAreaWidthIn: number
  readonly printAreaHeightIn: number
  readonly dpi: number
}

/** Minor-unit money as the provider quotes it (its own currency). */
export interface ProviderMoney {
  readonly amount: number
  readonly currency: string
}

export interface ShippingRateRequest {
  readonly countryCode: string
  readonly stateCode?: string
  readonly zip?: string
  readonly city?: string
  readonly items: ReadonlyArray<{ readonly catalogVariantId: number; readonly quantity: number }>
  /** Currency the rate should be quoted in. */
  readonly currency: string
}

export interface ShippingRate {
  /** Provider shipping method id, e.g. `STANDARD`. */
  readonly method: string
  readonly name: string
  readonly rate: ProviderMoney
  readonly minDeliveryDays?: number
  readonly maxDeliveryDays?: number
}

/** What the provider charges the Operator for one variant, per technique. */
export interface VariantPrices {
  readonly currency: string
  /** Technique key → base price in minor units (the discounted price when the provider offers one). */
  readonly byTechnique: Readonly<Record<string, number>>
  /** `placement/technique` → extra charged for printing there (0 for the placement included in the base price). */
  readonly placementSurcharge: Readonly<Record<string, number>>
}

/** Provider order statuses, mapped from Printful's (ADR-0009 maps these onto Order states). */
export type ProviderOrderStatus =
  | 'draft'
  | 'failed'
  | 'inreview'
  | 'pending'
  | 'canceled'
  | 'onhold'
  | 'inprocess'
  | 'partial'
  | 'fulfilled'
  /** A status this adapter does not recognize; never acted on. */
  | 'unknown'

export interface ProviderOrder {
  readonly id: string
  readonly externalId?: string
  /** Which submission attempt the external id encoded (#77); absent means the first. */
  readonly attempt?: number
  readonly status: ProviderOrderStatus
  readonly recipient: { readonly countryCode: string; readonly stateCode?: string }
  readonly items: ReadonlyArray<{
    readonly catalogVariantId: number
    readonly quantity: number
    /** A placement the provider could not accept (bad file, disjoint design), with its explanation. */
    readonly failedPlacement?: string
  }>
  /** The provider's own costs for this order, when calculated. */
  readonly costs?: {
    readonly currency: string
    readonly subtotal: number
    readonly shipping: number
    readonly tax: number
    readonly total: number
    readonly calculating: boolean
  }
  readonly dashboardUrl?: string
}

export interface ProviderRecipient {
  readonly name: string
  readonly address1: string
  readonly address2?: string
  readonly city: string
  readonly stateCode?: string
  readonly countryCode: string
  readonly zip?: string
  readonly email: string
  readonly phone?: string
}

export interface ProviderOrderDraft {
  /** Pressline Order ID; the provider stores it as the external id. */
  readonly externalId: string
  /**
   * Which submission attempt this is (#77). A provider never releases an
   * external id, not even for a canceled order, so a resubmission after one
   * needs a different id derived from the same Order. 0, the default, is the
   * first attempt and keeps the plain Order ID.
   */
  readonly attempt?: number
  readonly shippingMethod: string
  readonly recipient: ProviderRecipient
  readonly item: {
    readonly catalogVariantId: number
    readonly placement: string
    readonly technique: string
    readonly printfileUrl: string
    /** Retail price as a decimal string in `currency`, for the provider's packing slip. */
    readonly retailPrice?: string
  }
  readonly currency: string
}

export interface ProviderShipment {
  readonly id: string
  readonly status:
    'pending' | 'onhold' | 'canceled' | 'packaged' | 'shipped' | 'returned' | 'outstock'
  readonly carrier?: string
  readonly service?: string
  readonly trackingNumber?: string
  readonly trackingUrl?: string
  readonly shippedAt?: string
}

/** A verified provider webhook, reduced to what the handler needs; the payload is never the truth (ADR-0007). */
export interface ProviderWebhookEvent {
  /** Stable id derived from the delivery (Printful sends none), for the Inbound Event table. */
  readonly id: string
  readonly type: string
  /** Unix seconds. */
  readonly occurredAt: number
  readonly providerOrderId?: string
  /** Pressline Order ID as the provider echoes it. */
  readonly orderExternalId?: string
  readonly shipmentId?: string
}

export class ProviderWebhookRejected extends Schema.TaggedError<ProviderWebhookRejected>()(
  'ProviderWebhookRejected',
  { message: Schema.String },
) {}

export interface WebhookStatus {
  readonly configured: boolean
  readonly url?: string
  readonly detail?: string
}

export interface FulfillmentProviderService {
  readonly health: () => Effect.Effect<void, FulfillmentProviderError>
  /** Whether a webhook configuration exists on the provider account, and where it points. */
  readonly getWebhookStatus: () => Effect.Effect<WebhookStatus, FulfillmentProviderError>
  /** Verify a raw webhook body against the provider's signature headers. */
  readonly verifyWebhook: (
    rawBody: string,
    headers: { readonly signature?: string; readonly publicKey?: string },
  ) => Effect.Effect<ProviderWebhookEvent, ProviderWebhookRejected>
  /** Read an already-verified body again (Reconciliation replays stored Inbound Events). */
  readonly parseWebhook: (
    rawBody: string,
  ) => Effect.Effect<ProviderWebhookEvent, ProviderWebhookRejected>
  readonly listShipments: (
    providerOrderId: string,
  ) => Effect.Effect<ReadonlyArray<ProviderShipment>, FulfillmentProviderError>
  /** The provider order created for a Pressline Order ID, if any (the idempotency lookup, ADR-0009). */
  readonly findOrderByExternalId: (
    externalId: string,
    attempt?: number,
  ) => Effect.Effect<ProviderOrder | undefined, FulfillmentProviderError>
  readonly createOrderDraft: (
    draft: ProviderOrderDraft,
  ) => Effect.Effect<ProviderOrder, FulfillmentProviderError>
  readonly confirmOrder: (id: string) => Effect.Effect<ProviderOrder, FulfillmentProviderError>
  /**
   * Cancel a provider order when the provider allows it. Printful v2 deletes
   * drafts, failed and on-hold orders; an order already in production answers
   * `not_cancelable` and must be handled with the provider directly.
   */
  readonly cancelOrder: (
    id: string,
  ) => Effect.Effect<'canceled' | 'not_cancelable', FulfillmentProviderError>
  /** Replace the recipient on a draft (or held) provider order; a non-retryable error when the provider refuses. */
  readonly updateOrderRecipient: (
    id: string,
    recipient: ProviderRecipient,
  ) => Effect.Effect<ProviderOrder, FulfillmentProviderError>
  readonly getOrder: (id: string) => Effect.Effect<ProviderOrder, FulfillmentProviderError>
  /** Live shipping options for a destination. Empty when the provider cannot ship there. */
  readonly getShippingRates: (
    req: ShippingRateRequest,
  ) => Effect.Effect<ReadonlyArray<ShippingRate>, FulfillmentProviderError>
  readonly getVariantPrices: (
    variantId: number,
    currency: string,
  ) => Effect.Effect<VariantPrices, FulfillmentProviderError>
  readonly getCatalogProduct: (
    id: number,
  ) => Effect.Effect<CatalogProduct, FulfillmentProviderError>
  readonly getCatalogVariant: (
    id: number,
  ) => Effect.Effect<CatalogVariant, FulfillmentProviderError>
  /** Per-placement print area and DPI for a product (Printful: mockup-styles). */
  readonly getPlacementPrintAreas: (
    productId: number,
  ) => Effect.Effect<ReadonlyArray<PlacementPrintArea>, FulfillmentProviderError>
  /** The whole provider catalog (every page); the CLI searches it by name. */
  readonly listCatalogProducts: () => Effect.Effect<
    ReadonlyArray<CatalogProduct>,
    FulfillmentProviderError
  >
  readonly listCatalogVariants: (
    productId: number,
  ) => Effect.Effect<ReadonlyArray<CatalogVariant>, FulfillmentProviderError>
  /**
   * Point the provider's webhooks at `url` for the events Pressline handles.
   * The signing secret is only revealed when a configuration is created.
   */
  readonly registerWebhook: (
    url: string,
  ) => Effect.Effect<WebhookRegistration, FulfillmentProviderError>
}

export interface WebhookRegistration {
  readonly status: 'created' | 'verified'
  readonly url: string
  /** Present only when created: the Operator must store it as the webhook secret. */
  readonly secret?: string
  /** Provider-specific second credential (Printful's public key), when created. */
  readonly publicKey?: string
}

export class FulfillmentProvider extends Context.Tag('pressline/FulfillmentProvider')<
  FulfillmentProvider,
  FulfillmentProviderService
>() {}
