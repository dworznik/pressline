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
        provider.cancelOrder(id).pipe(
          Effect.flatMap(() => provider.getOrder(id)),
          Effect.map((order) => ({ ...order, status: 'canceled' as const })),
        ),
    })),
  ).pipe(Layer.provide(inner));
