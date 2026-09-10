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

export interface FulfilmentProviderService {
  readonly health: () => Effect.Effect<void, FulfilmentProviderError>;
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
