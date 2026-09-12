import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { demoFulfillmentProvider } from '$lib/server/services/demo';
import {
  FulfillmentProvider,
  FulfillmentProviderError,
  type FulfillmentProviderService,
} from '$lib/server/services/fulfillment-provider';
import { layerFulfillmentProviderMemory } from '$lib/server/services/memory';

/**
 * Printful deletes a canceled draft, so it cannot be fetched afterwards. The
 * in-memory provider keeps it; this wrapper makes it disappear the way
 * Printful's does.
 */
const layerDeletingOnCancel = Layer.effect(
  FulfillmentProvider,
  Effect.map(FulfillmentProvider, (p): FulfillmentProviderService => {
    const deleted = new Set<string>();
    return {
      ...p,
      cancelOrder: (id) =>
        p.cancelOrder(id).pipe(Effect.tap(() => Effect.sync(() => deleted.add(id)))),
      getOrder: (id) =>
        deleted.has(id)
          ? Effect.fail(
              new FulfillmentProviderError({
                message: 'Printful 404: Not Found',
                retryable: false,
                status: 404,
              }),
            )
          : p.getOrder(id),
    };
  }),
).pipe(Layer.provide(layerFulfillmentProviderMemory));

describe('Demo Mode provider', () => {
  it('confirming a draft cancels it and still answers with the order, although the provider has deleted it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* FulfillmentProvider;
        const draft = yield* p.createOrderDraft({
          externalId: '01a09567-00cb-7424-aaa8-547f582bc7b6',
          shippingMethod: 'STANDARD',
          recipient: {
            name: 'Anna Example',
            address1: 'Torstraße 1',
            city: 'Berlin',
            countryCode: 'DE',
            zip: '10119',
            email: 'anna@example.com',
          },
          item: {
            catalogVariantId: 4017,
            placement: 'front',
            technique: 'dtg',
            printfileUrl: 'https://engine.test/files/heron/front.png',
          },
          currency: 'EUR',
        });
        const confirmed = yield* p.confirmOrder(draft.id);
        const afterwards = yield* p.getOrder(draft.id).pipe(Effect.either);
        return { draft, confirmed, afterwards };
      }).pipe(Effect.provide(demoFulfillmentProvider(layerDeletingOnCancel))),
    );
    expect(result.confirmed).toMatchObject({ id: result.draft.id, status: 'canceled' });
    expect(result.afterwards._tag).toBe('Left');
  });
});
