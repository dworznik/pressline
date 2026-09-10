import { Effect, Schema } from 'effect';
import { findOrder, OrderNotFound } from './orders';
import { OrderState } from './state';

/**
 * What a Customer may see of their Order (ticket #13 builds the page on it):
 * gated by the per-order status token, Recipient masked to first name, city
 * and country so a forwarded link leaks no address.
 */
export const PublicOrder = Schema.Struct({
  id: Schema.String,
  state: OrderState,
  offer: Schema.String,
  variant: Schema.String,
  currency: Schema.String,
  retail: Schema.Int,
  shipping: Schema.Int,
  amountTotal: Schema.optional(Schema.Int),
  recipient: Schema.optional(
    Schema.Struct({ firstName: Schema.String, city: Schema.String, country: Schema.String }),
  ),
  tracking: Schema.optional(
    Schema.Struct({ carrier: Schema.optional(Schema.String), url: Schema.optional(Schema.String) }),
  ),
  createdAt: Schema.Int,
});
export type PublicOrder = typeof PublicOrder.Type;

/** A wrong token is indistinguishable from a missing Order. */
export const publicOrder = (id: string, token: string) =>
  Effect.gen(function* () {
    const order = yield* findOrder(id);
    if (order.statusToken !== token) return yield* new OrderNotFound({ id });
    const r = order.recipient;
    return {
      id: order.id,
      state: order.state,
      offer: order.offer,
      variant: order.variant,
      currency: order.currency,
      retail: order.retail,
      shipping: order.shipping,
      ...(order.amountTotal !== undefined ? { amountTotal: order.amountTotal } : {}),
      ...(r
        ? {
            recipient: {
              firstName: r.name.split(/\s+/)[0] ?? '',
              city: r.city,
              country: r.country,
            },
          }
        : {}),
      ...(order.tracking
        ? {
            tracking: {
              ...(order.tracking.carrier ? { carrier: order.tracking.carrier } : {}),
              ...(order.tracking.url ? { url: order.tracking.url } : {}),
            },
          }
        : {}),
      createdAt: order.createdAt,
    } satisfies PublicOrder;
  });
