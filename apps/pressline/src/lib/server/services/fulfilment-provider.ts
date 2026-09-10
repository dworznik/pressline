import { Context, Schema } from 'effect';
import type { Effect } from 'effect';

/**
 * Fulfilment Provider (CONTEXT.md): prints and ships. Printful v2 is the only
 * shipped implementation (ADR-0007). Shapes here are provider-neutral; the
 * adapter maps Printful's wire format onto them. Method set grows per ticket.
 */
export class FulfilmentProviderError extends Schema.TaggedError<FulfilmentProviderError>()(
  'FulfilmentProviderError',
  {
    message: Schema.String,
    retryable: Schema.Boolean,
    status: Schema.optional(Schema.Number),
  },
) {}

/** A (placement, technique) pair: how a product can be printed. */
export interface PrintMethod {
  readonly placement: string;
  readonly technique: string;
}

export const samePrintMethod = (a: PrintMethod, b: PrintMethod) =>
  a.placement === b.placement && a.technique === b.technique;

export interface CatalogProduct {
  readonly id: number;
  readonly name: string;
  readonly printMethods: ReadonlyArray<PrintMethod>;
}

export interface CatalogVariant {
  readonly id: number;
  readonly catalogProductId: number;
  readonly name: string;
  readonly size?: string;
  readonly color?: string;
  readonly imageUrl?: string;
  /** Print area per placement, in inches. */
  readonly placementDimensions: ReadonlyArray<{
    readonly placement: string;
    readonly widthIn: number;
    readonly heightIn: number;
    readonly orientation: string;
  }>;
}

export interface PlacementPrintArea extends PrintMethod {
  readonly printAreaWidthIn: number;
  readonly printAreaHeightIn: number;
  readonly dpi: number;
}

/** Minor-unit money as the provider quotes it (its own currency). */
export interface ProviderMoney {
  readonly amount: number;
  readonly currency: string;
}

export interface ShippingRateRequest {
  readonly countryCode: string;
  readonly stateCode?: string;
  readonly zip?: string;
  readonly city?: string;
  readonly items: ReadonlyArray<{ readonly catalogVariantId: number; readonly quantity: number }>;
  /** Currency the rate should be quoted in. */
  readonly currency: string;
}

export interface ShippingRate {
  /** Provider shipping method id, e.g. `STANDARD`. */
  readonly method: string;
  readonly name: string;
  readonly rate: ProviderMoney;
  readonly minDeliveryDays?: number;
  readonly maxDeliveryDays?: number;
}

/** What the provider charges the Operator for one variant, per technique. */
export interface VariantPrices {
  readonly currency: string;
  /** Technique key → base price in minor units (the discounted price when the provider offers one). */
  readonly byTechnique: Readonly<Record<string, number>>;
  /** `placement/technique` → extra charged for printing there (0 for the placement included in the base price). */
  readonly placementSurcharge: Readonly<Record<string, number>>;
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
  /** A status this adapter does not recognise; never acted on. */
  | 'unknown';

export interface ProviderOrder {
  readonly id: string;
  readonly externalId?: string;
  readonly status: ProviderOrderStatus;
  readonly recipient: { readonly countryCode: string; readonly stateCode?: string };
  readonly items: ReadonlyArray<{
    readonly catalogVariantId: number;
    readonly quantity: number;
    /** A placement the provider could not accept (bad file, disjoint design), with its explanation. */
    readonly failedPlacement?: string;
  }>;
  /** The provider's own costs for this order, when calculated. */
  readonly costs?: {
    readonly currency: string;
    readonly subtotal: number;
    readonly shipping: number;
    readonly tax: number;
    readonly total: number;
    readonly calculating: boolean;
  };
  readonly dashboardUrl?: string;
}

export interface ProviderRecipient {
  readonly name: string;
  readonly address1: string;
  readonly address2?: string;
  readonly city: string;
  readonly stateCode?: string;
  readonly countryCode: string;
  readonly zip?: string;
  readonly email: string;
  readonly phone?: string;
}

export interface ProviderOrderDraft {
  /** Pressline Order ID; the provider stores it as the external id. */
  readonly externalId: string;
  readonly shippingMethod: string;
  readonly recipient: ProviderRecipient;
  readonly item: {
    readonly catalogVariantId: number;
    readonly placement: string;
    readonly technique: string;
    readonly printfileUrl: string;
    /** Retail price as a decimal string in `currency`, for the provider's packing slip. */
    readonly retailPrice?: string;
  };
  readonly currency: string;
}

export interface ProviderShipment {
  readonly id: string;
  readonly status:
    'pending' | 'onhold' | 'canceled' | 'packaged' | 'shipped' | 'returned' | 'outstock';
  readonly carrier?: string;
  readonly service?: string;
  readonly trackingNumber?: string;
  readonly trackingUrl?: string;
  readonly shippedAt?: string;
}

/** A verified provider webhook, reduced to what the handler needs; the payload is never the truth (ADR-0007). */
export interface ProviderWebhookEvent {
  /** Stable id derived from the delivery (Printful sends none), for the Inbound Event table. */
  readonly id: string;
  readonly type: string;
  /** Unix seconds. */
  readonly occurredAt: number;
  readonly providerOrderId?: string;
  /** Pressline Order ID as the provider echoes it. */
  readonly orderExternalId?: string;
  readonly shipmentId?: string;
}

export class ProviderWebhookRejected extends Schema.TaggedError<ProviderWebhookRejected>()(
  'ProviderWebhookRejected',
  { message: Schema.String },
) {}

export interface FulfilmentProviderService {
  readonly health: () => Effect.Effect<void, FulfilmentProviderError>;
  /** Verify a raw webhook body against the provider's signature headers. */
  readonly verifyWebhook: (
    rawBody: string,
    headers: { readonly signature?: string; readonly publicKey?: string },
  ) => Effect.Effect<ProviderWebhookEvent, ProviderWebhookRejected>;
  readonly listShipments: (
    providerOrderId: string,
  ) => Effect.Effect<ReadonlyArray<ProviderShipment>, FulfilmentProviderError>;
  /** The provider order created for a Pressline Order ID, if any (the idempotency lookup, ADR-0009). */
  readonly findOrderByExternalId: (
    externalId: string,
  ) => Effect.Effect<ProviderOrder | undefined, FulfilmentProviderError>;
  readonly createOrderDraft: (
    draft: ProviderOrderDraft,
  ) => Effect.Effect<ProviderOrder, FulfilmentProviderError>;
  readonly confirmOrder: (id: string) => Effect.Effect<ProviderOrder, FulfilmentProviderError>;
  /** Cancel/delete a provider order. Printful v2 deletes drafts, failed and cancelled orders; confirmed orders need support. */
  readonly cancelOrder: (id: string) => Effect.Effect<void, FulfilmentProviderError>;
  readonly getOrder: (id: string) => Effect.Effect<ProviderOrder, FulfilmentProviderError>;
  /** Live shipping options for a destination. Empty when the provider cannot ship there. */
  readonly getShippingRates: (
    req: ShippingRateRequest,
  ) => Effect.Effect<ReadonlyArray<ShippingRate>, FulfilmentProviderError>;
  readonly getVariantPrices: (
    variantId: number,
    currency: string,
  ) => Effect.Effect<VariantPrices, FulfilmentProviderError>;
  readonly getCatalogProduct: (
    id: number,
  ) => Effect.Effect<CatalogProduct, FulfilmentProviderError>;
  readonly getCatalogVariant: (
    id: number,
  ) => Effect.Effect<CatalogVariant, FulfilmentProviderError>;
  /** Per-placement print area and DPI for a product (Printful: mockup-styles). */
  readonly getPlacementPrintAreas: (
    productId: number,
  ) => Effect.Effect<ReadonlyArray<PlacementPrintArea>, FulfilmentProviderError>;
}

export class FulfilmentProvider extends Context.Tag('pressline/FulfilmentProvider')<
  FulfilmentProvider,
  FulfilmentProviderService
>() {}
