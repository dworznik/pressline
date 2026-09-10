import { Context, Effect, Layer, Ref, Schema } from 'effect';

/**
 * Fulfilment Provider (CONTEXT.md): prints and ships. Printful v2 is the only
 * shipped implementation (ADR-0007). Shapes here are provider-neutral; the
 * adapter maps Printful's wire format onto them. Method set grows per ticket.
 */
export class ProviderError extends Schema.TaggedError<ProviderError>()('ProviderError', {
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optional(Schema.Number),
}) {}

export interface CatalogProduct {
  readonly id: number;
  readonly name: string;
  /** Placement key + technique pairs the product supports. */
  readonly placements: ReadonlyArray<{ readonly placement: string; readonly technique: string }>;
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

export interface PlacementPrintArea {
  readonly placement: string;
  readonly technique: string;
  readonly printAreaWidthIn: number;
  readonly printAreaHeightIn: number;
  readonly dpi: number;
}

export interface FulfilmentProviderService {
  readonly health: () => Effect.Effect<void, ProviderError>;
  readonly getCatalogProduct: (id: number) => Effect.Effect<CatalogProduct, ProviderError>;
  readonly getCatalogVariant: (id: number) => Effect.Effect<CatalogVariant, ProviderError>;
  /** Per-placement print area and DPI for a product (Printful: mockup-styles). */
  readonly getPlacementPrintAreas: (
    productId: number,
  ) => Effect.Effect<ReadonlyArray<PlacementPrintArea>, ProviderError>;
}

export class FulfilmentProvider extends Context.Tag('pressline/FulfilmentProvider')<
  FulfilmentProvider,
  FulfilmentProviderService
>() {}

export interface MemoryCatalog {
  readonly products: ReadonlyArray<CatalogProduct>;
  readonly variants: ReadonlyArray<CatalogVariant>;
  readonly printAreas: Readonly<Record<number, ReadonlyArray<PlacementPrintArea>>>;
}

const notFound = (what: string, id: number) =>
  new ProviderError({ message: `${what} ${id} not found`, retryable: false, status: 404 });

/**
 * In-memory provider for tests: serves a seeded catalog and counts calls so
 * HTTP-seam tests can assert that a cache hit does not reach the provider.
 */
export const makeFulfilmentProviderMemory = (catalog: MemoryCatalog = emptyCatalog) =>
  Effect.map(Ref.make(0), (calls) => {
    const count = Ref.update(calls, (n) => n + 1);
    const find = <A>(what: string, id: number, item: A | undefined) =>
      count.pipe(Effect.flatMap(() => (item ? Effect.succeed(item) : notFound(what, id))));
    return {
      layer: Layer.succeed(FulfilmentProvider, {
        health: () => Effect.void,
        getCatalogProduct: (id) =>
          find(
            'catalog product',
            id,
            catalog.products.find((p) => p.id === id),
          ),
        getCatalogVariant: (id) =>
          find(
            'catalog variant',
            id,
            catalog.variants.find((v) => v.id === id),
          ),
        getPlacementPrintAreas: (productId) =>
          find('catalog product', productId, catalog.printAreas[productId]),
      }),
      calls: Ref.get(calls),
    };
  });

export const emptyCatalog: MemoryCatalog = { products: [], variants: [], printAreas: {} };

export const layerFulfilmentProviderMemory = Layer.unwrapEffect(
  Effect.map(makeFulfilmentProviderMemory(), (m) => m.layer),
);
