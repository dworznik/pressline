import { Effect, Schema } from 'effect';
import { timingSafeEqual } from '../security';
import { Config } from '../config/schema';
import { DesignSource } from '../services/design-source';
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
  /** Display names from the Catalogue (fall back to the slugs if the Offer was removed). */
  offerName: Schema.String,
  variantLabel: Schema.String,
  /** The design's Preview, hot-linked from the Engine when it still answers. */
  previewUrl: Schema.optional(Schema.String),
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
    if (!timingSafeEqual(order.statusToken, token)) return yield* new OrderNotFound({ id });
    const config = yield* Config;
    const offer = config.catalogue.offers.find((o) => o.slug === order.offer);
    const previewUrl =
      order.previewUrl ??
      (yield* Effect.flatMap(DesignSource, (s) => s.getDesign(order.engine, order.designId)).pipe(
        Effect.map((d) => d.previewUrl),
        Effect.option,
        Effect.map((o) => (o._tag === 'Some' ? o.value : undefined)),
      ));
    const r = order.recipient;
    return {
      id: order.id,
      state: order.state,
      offer: order.offer,
      variant: order.variant,
      offerName: offer?.name ?? order.offer,
      variantLabel: offer?.variants[order.variant]?.label ?? order.variant,
      ...(previewUrl ? { previewUrl } : {}),
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
              // Only web URLs reach the page; the carrier link came from the provider, not from us.
              ...(order.tracking.url && /^https?:\/\//i.test(order.tracking.url)
                ? { url: order.tracking.url }
                : {}),
            },
          }
        : {}),
      createdAt: order.createdAt,
    } satisfies PublicOrder;
  });
