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

export interface FulfilmentProviderService {
  readonly health: () => Effect.Effect<void, FulfilmentProviderError>;
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
