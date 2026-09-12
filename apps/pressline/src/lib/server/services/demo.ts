import { Effect, Layer } from 'effect'
import { FulfillmentProvider, type FulfillmentProviderService } from './fulfillment-provider'

/**
 * Demo Mode (CONTEXT.md): the real fulfillment provider, except that confirming
 * a draft cancels it instead. Drafts are created for real (so addresses,
 * files and costs are checked), and nothing is ever produced or paid for.
 */
export const demoFulfillmentProvider = <E, R>(inner: Layer.Layer<FulfillmentProvider, E, R>) =>
  Layer.effect(
    FulfillmentProvider,
    Effect.map(FulfillmentProvider, (provider): FulfillmentProviderService => ({
      ...provider,
      confirmOrder: (id) =>
        // Read before canceling: Printful deletes a canceled draft, so it cannot be fetched afterwards.
        provider
          .getOrder(id)
          .pipe(
            Effect.flatMap((order) =>
              provider.cancelOrder(id).pipe(Effect.as({ ...order, status: 'canceled' as const })),
            ),
          ),
    })),
  ).pipe(Layer.provide(inner))
