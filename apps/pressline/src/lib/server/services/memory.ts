import { PROTOCOL_VERSION } from '@pressline/contract';
import { Effect, Layer, Ref } from 'effect';
import { DesignSource } from './design-source';
import {
  FulfilmentProvider,
  FulfilmentProviderError,
  type CatalogProduct,
  type CatalogVariant,
  type PlacementPrintArea,
} from './fulfilment-provider';
import { Mailer, type Email } from './mailer';
import { Psp } from './psp';

/**
 * In-memory implementations of every external service. Used by the HTTP-seam
 * test harness and as boot-time stand-ins before an Operator has configured
 * the real providers. Kept apart from the production modules so test-double
 * changes never touch them.
 */

export const layerDesignSourceMemory = (options: { protocolVersion?: string } = {}) =>
  Layer.succeed(DesignSource, {
    health: () => Effect.succeed({ protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION }),
  });

export const layerPspMemory = Layer.succeed(Psp, { health: () => Effect.void });

export interface MemoryCatalog {
  readonly products: ReadonlyArray<CatalogProduct>;
  readonly variants: ReadonlyArray<CatalogVariant>;
  readonly printAreas: Readonly<Record<number, ReadonlyArray<PlacementPrintArea>>>;
}

export const emptyCatalog: MemoryCatalog = { products: [], variants: [], printAreas: {} };

const notFound = (what: string, id: number) =>
  new FulfilmentProviderError({
    message: `${what} ${id} not found`,
    retryable: false,
    status: 404,
  });

/**
 * Serves a seeded catalog and counts every call, so HTTP-seam tests can
 * assert that a cache hit does not reach the provider.
 */
export const makeFulfilmentProviderMemory = (catalog: MemoryCatalog = emptyCatalog) =>
  Effect.map(Ref.make(0), (calls) => {
    const counted = <A>(what: string, id: number, item: A | undefined) =>
      Ref.update(calls, (n) => n + 1).pipe(
        Effect.flatMap(() => (item ? Effect.succeed(item) : notFound(what, id))),
      );
    return {
      layer: Layer.succeed(FulfilmentProvider, {
        health: () => Effect.void,
        getCatalogProduct: (id) =>
          counted(
            'catalog product',
            id,
            catalog.products.find((p) => p.id === id),
          ),
        getCatalogVariant: (id) =>
          counted(
            'catalog variant',
            id,
            catalog.variants.find((v) => v.id === id),
          ),
        getPlacementPrintAreas: (productId) =>
          counted('catalog product', productId, catalog.printAreas[productId]),
      }),
      calls: Ref.get(calls),
    };
  });

export const layerFulfilmentProviderMemory = Layer.unwrapEffect(
  Effect.map(makeFulfilmentProviderMemory(), (m) => m.layer),
);

/** Records sends so tests can read what was sent. */
export const makeMailerMemory = Effect.map(Ref.make<ReadonlyArray<Email>>([]), (ref) => ({
  layer: Layer.succeed(Mailer, {
    send: (email) => Ref.update(ref, (sent) => [...sent, email]),
  }),
  sent: Ref.get(ref),
}));
