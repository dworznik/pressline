import { Effect, Layer } from 'effect';
import { FulfilmentProvider, type FulfilmentProviderService } from './fulfilment-provider';

/**
 * Demo Mode (CONTEXT.md): the real fulfilment provider, except that confirming
 * a draft cancels it instead. Drafts are created for real (so addresses,
 * files and costs are checked), and nothing is ever produced or paid for.
 */
export const demoFulfilmentProvider = <E, R>(inner: Layer.Layer<FulfilmentProvider, E, R>) =>
  Layer.effect(
    FulfilmentProvider,
    Effect.map(FulfilmentProvider, (provider): FulfilmentProviderService => ({
      ...provider,
      confirmOrder: (id) =>
        // Read before cancelling: Printful deletes a cancelled draft, so it cannot be fetched afterwards.
        provider
          .getOrder(id)
          .pipe(
            Effect.flatMap((order) =>
              provider.cancelOrder(id).pipe(Effect.as({ ...order, status: 'canceled' as const })),
            ),
          ),
    })),
  ).pipe(Layer.provide(inner));
