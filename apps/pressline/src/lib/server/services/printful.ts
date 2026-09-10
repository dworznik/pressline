import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import type { HttpClientError } from '@effect/platform';

import { Duration, Effect, Layer, Schema } from 'effect';
import {
  FulfilmentProvider,
  FulfilmentProviderError,
  type CatalogProduct,
  type CatalogVariant,
  type FulfilmentProviderService,
  type PlacementPrintArea,
  type ProviderOrder,
  type ProviderOrderStatus,
  type ShippingRate,
  type VariantPrices,
} from './fulfilment-provider';
import { DecimalString, toMinorUnits } from '../money';

/**
 * Printful API v2 adapter (ADR-0007). The only place Printful's wire shapes
 * appear. Decoding is lenient (only the fields we use are required) so a
 * beta-time field shuffle degrades to a FulfilmentProviderError, not a crash.
 */
export interface PrintfulOptions {
  readonly token: string;
  readonly baseUrl?: string;
  /** Bound on one request including body decoding; a stall is a retryable error. */
  readonly timeout?: Duration.DurationInput;
}

export const DEFAULT_TIMEOUT: Duration.DurationInput = '15 seconds';

const Envelope = <A, I>(data: Schema.Schema<A, I>) => Schema.Struct({ data });

const ProductWire = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  placements: Schema.Array(Schema.Struct({ placement: Schema.String, technique: Schema.String })),
});

const VariantWire = Schema.Struct({
  id: Schema.Number,
  catalog_product_id: Schema.Number,
  name: Schema.String,
  size: Schema.optional(Schema.NullOr(Schema.String)),
  color: Schema.optional(Schema.NullOr(Schema.String)),
  image: Schema.optional(Schema.NullOr(Schema.String)),
  placement_dimensions: Schema.Array(
    Schema.Struct({
      placement: Schema.String,
      width: Schema.Number,
      height: Schema.Number,
      orientation: Schema.optional(Schema.String),
    }),
  ),
});

const MockupStyleWire = Schema.Struct({
  placement: Schema.String,
  technique: Schema.String,
  print_area_width: Schema.Number,
  print_area_height: Schema.Number,
  dpi: Schema.Number,
});

const ShippingRateWire = Schema.Struct({
  shipping: Schema.String,
  shipping_method_name: Schema.String,
  rate: DecimalString,
  currency: Schema.String,
  min_delivery_days: Schema.optional(Schema.NullOr(Schema.Number)),
  max_delivery_days: Schema.optional(Schema.NullOr(Schema.Number)),
});

const PricesWire = Schema.Struct({
  currency: Schema.String,
  product: Schema.optional(
    Schema.Struct({
      placements: Schema.optional(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            technique_key: Schema.String,
            price: DecimalString,
            discounted_price: Schema.optional(Schema.NullOr(DecimalString)),
          }),
        ),
      ),
    }),
  ),
  variant: Schema.Struct({
    id: Schema.Number,
    techniques: Schema.Array(
      Schema.Struct({
        technique_key: Schema.String,
        price: DecimalString,
        discounted_price: Schema.optional(Schema.NullOr(DecimalString)),
      }),
    ),
  }),
});

/** Printful's method names carry a dated estimate ("Flat Rate (Estimated delivery: May 19–24)"); the Quote computes its own days. */
const cleanMethodName = (name: string) =>
  name.replace(/\s*\(estimated delivery:[^)]*\)\s*/i, '').trim();

const OrderCostsWire = Schema.Struct({
  calculation_status: Schema.optional(Schema.String),
  currency: Schema.String,
  subtotal: Schema.optional(DecimalString),
  shipping: Schema.optional(DecimalString),
  tax: Schema.optional(DecimalString),
  vat: Schema.optional(DecimalString),
  total: Schema.optional(DecimalString),
});

const OrderWire = Schema.Struct({
  id: Schema.Number,
  external_id: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  recipient: Schema.Struct({
    country_code: Schema.String,
    state_code: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  order_items: Schema.optional(
    Schema.Array(
      Schema.Struct({
        catalog_variant_id: Schema.optional(Schema.Number),
        quantity: Schema.optional(Schema.Number),
        placements: Schema.optional(
          Schema.Array(
            Schema.Struct({
              placement: Schema.String,
              status: Schema.optional(Schema.String),
              status_explanation: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
  costs: Schema.optional(Schema.NullOr(OrderCostsWire)),
  _links: Schema.optional(Schema.Unknown),
});

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'draft',
  'failed',
  'inreview',
  'pending',
  'canceled',
  'onhold',
  'inprocess',
  'partial',
  'fulfilled',
]);

const toProviderOrder = (o: typeof OrderWire.Type): ProviderOrder => {
  const costs = o.costs ?? undefined;
  return {
    id: String(o.id),
    ...(o.external_id ? { externalId: o.external_id } : {}),
    // An unknown future status is treated as "in review": neither final nor actionable.
    status: (ORDER_STATUSES.has(o.status) ? o.status : 'inreview') as ProviderOrderStatus,
    recipient: {
      countryCode: o.recipient.country_code,
      ...(o.recipient.state_code ? { stateCode: o.recipient.state_code } : {}),
    },
    items: (o.order_items ?? []).map((i) => {
      const failed = i.placements?.find((p) => p.status === 'failed');
      return {
        catalogVariantId: i.catalog_variant_id ?? 0,
        quantity: i.quantity ?? 1,
        ...(failed
          ? { failedPlacement: `${failed.placement}: ${failed.status_explanation ?? 'rejected'}` }
          : {}),
      };
    }),
    ...(costs
      ? {
          costs: {
            currency: costs.currency,
            subtotal: toMinorUnits(costs.subtotal ?? '0', costs.currency),
            shipping: toMinorUnits(costs.shipping ?? '0', costs.currency),
            tax:
              toMinorUnits(costs.tax ?? '0', costs.currency) +
              toMinorUnits(costs.vat ?? '0', costs.currency),
            total: toMinorUnits(costs.total ?? '0', costs.currency),
            calculating: costs.calculation_status === 'calculating',
          },
        }
      : {}),
  };
};

const ErrorWire = Schema.Struct({
  code: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});

const toFulfilmentProviderError = (
  e: HttpClientError.HttpClientError | FulfilmentProviderError,
): FulfilmentProviderError => {
  if (e instanceof FulfilmentProviderError) return e;
  return new FulfilmentProviderError({ message: `Printful: ${e.message}`, retryable: true });
};

const failStatus = (res: HttpClientResponse.HttpClientResponse) =>
  res.json.pipe(
    Effect.orElseSucceed(() => ({})),
    Effect.flatMap((body) =>
      Schema.decodeUnknown(ErrorWire)(body).pipe(
        Effect.orElseSucceed(() => ({}) as typeof ErrorWire.Type),
      ),
    ),
    Effect.flatMap((body) => {
      const detail = body.result ?? body.error?.message ?? res.status.toString();
      const retryable = res.status === 429 || res.status >= 500;
      return new FulfilmentProviderError({
        message: `Printful ${res.status}: ${detail}`,
        retryable,
        status: res.status,
      });
    }),
  );

export const makePrintful = (options: PrintfulOptions) =>
  Effect.gen(function* () {
    const base = (options.baseUrl ?? 'https://api.printful.com').replace(/\/$/, '');
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.bearerToken(options.token)),
      HttpClient.mapRequest(HttpClientRequest.prependUrl(base)),
    );

    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const get = <A, I>(path: string, schema: Schema.Schema<A, I>) =>
      client.get(path).pipe(
        Effect.flatMap((res) =>
          res.status >= 200 && res.status < 300
            ? HttpClientResponse.schemaBodyJson(schema)(res).pipe(
                Effect.mapError(
                  (e) =>
                    new FulfilmentProviderError({
                      message: `Printful ${path}: ${e.message}`,
                      retryable: false,
                    }),
                ),
              )
            : failStatus(res),
        ),
        Effect.mapError(toFulfilmentProviderError),
        Effect.scoped,
        // Bounds the request and the body decode together; a stall is retryable.
        Effect.timeoutFail({
          duration: timeout,
          onTimeout: () =>
            new FulfilmentProviderError({
              message: `Printful ${path}: no response within ${Duration.format(timeout)}`,
              retryable: true,
            }),
        }),
      );

    const post = <A, I>(path: string, body: unknown, schema: Schema.Schema<A, I>) =>
      HttpClientRequest.post(path).pipe(
        HttpClientRequest.bodyJson(body),
        Effect.mapError(
          (e) =>
            new FulfilmentProviderError({
              message: `Printful ${path}: could not encode request body (${e.reason._tag})`,
              retryable: false,
            }),
        ),
        Effect.flatMap((req) => client.execute(req)),
        Effect.flatMap((res) =>
          res.status >= 200 && res.status < 300
            ? HttpClientResponse.schemaBodyJson(schema)(res).pipe(
                Effect.mapError(
                  (e) =>
                    new FulfilmentProviderError({
                      message: `Printful ${path}: ${e.message}`,
                      retryable: false,
                    }),
                ),
              )
            : failStatus(res),
        ),
        Effect.mapError(toFulfilmentProviderError),
        Effect.scoped,
        Effect.timeoutFail({
          duration: timeout,
          onTimeout: () =>
            new FulfilmentProviderError({
              message: `Printful ${path}: no response within ${Duration.format(timeout)}`,
              retryable: true,
            }),
        }),
      );

    const service: FulfilmentProviderService = {
      health: () => get('/v2/catalog-products?limit=1', Schema.Unknown).pipe(Effect.asVoid),

      findOrderByExternalId: (externalId) =>
        get(`/v2/orders/@${encodeURIComponent(externalId)}`, Envelope(OrderWire)).pipe(
          Effect.map(({ data }) => toProviderOrder(data)),
          Effect.catchIf(
            (e) => e.status === 404,
            () => Effect.succeed(undefined),
          ),
        ),

      createOrderDraft: (d) =>
        post(
          '/v2/orders',
          {
            external_id: d.externalId,
            shipping: d.shippingMethod,
            recipient: {
              name: d.recipient.name,
              address1: d.recipient.address1,
              ...(d.recipient.address2 ? { address2: d.recipient.address2 } : {}),
              city: d.recipient.city,
              ...(d.recipient.stateCode ? { state_code: d.recipient.stateCode } : {}),
              country_code: d.recipient.countryCode,
              ...(d.recipient.zip ? { zip: d.recipient.zip } : {}),
              email: d.recipient.email,
              ...(d.recipient.phone ? { phone: d.recipient.phone } : {}),
            },
            order_items: [
              {
                source: 'catalog',
                catalog_variant_id: d.item.catalogVariantId,
                quantity: 1,
                ...(d.item.retailPrice ? { retail_price: d.item.retailPrice } : {}),
                placements: [
                  {
                    placement: d.item.placement,
                    technique: d.item.technique,
                    layers: [{ type: 'file', url: d.item.printfileUrl }],
                  },
                ],
              },
            ],
            retail_costs: { currency: d.currency },
          },
          Envelope(OrderWire),
        ).pipe(Effect.map(({ data }) => toProviderOrder(data))),

      confirmOrder: (id) =>
        post(`/v2/orders/${encodeURIComponent(id)}/confirmation`, {}, Envelope(OrderWire)).pipe(
          Effect.map(({ data }) => toProviderOrder(data)),
        ),

      getOrder: (id) =>
        get(`/v2/orders/${encodeURIComponent(id)}`, Envelope(OrderWire)).pipe(
          Effect.map(({ data }) => toProviderOrder(data)),
        ),

      getShippingRates: (req) =>
        post(
          '/v2/shipping-rates',
          {
            recipient: {
              country_code: req.countryCode,
              ...(req.stateCode ? { state_code: req.stateCode } : {}),
              ...(req.zip ? { zip: req.zip } : {}),
              ...(req.city ? { city: req.city } : {}),
            },
            order_items: req.items.map((i) => ({
              source: 'catalog',
              catalog_variant_id: i.catalogVariantId,
              quantity: i.quantity,
            })),
            currency: req.currency,
          },
          Envelope(Schema.Array(ShippingRateWire)),
        ).pipe(
          // Printful answers 400 for a destination it cannot ship to; that is "no options",
          // not an outage. Any other 400 (bad variant, malformed body) stays an error.
          Effect.catchIf(
            (e) =>
              e.status === 400 &&
              /not (available|possible|supported)|cannot ship|no shipping/i.test(e.message),
            () => Effect.succeed({ data: [] as ReadonlyArray<typeof ShippingRateWire.Type> }),
          ),
          Effect.map(({ data }) =>
            data.map((r): ShippingRate => ({
              method: r.shipping,
              name: cleanMethodName(r.shipping_method_name),
              rate: { amount: toMinorUnits(r.rate, r.currency), currency: r.currency },
              ...(r.min_delivery_days != null ? { minDeliveryDays: r.min_delivery_days } : {}),
              ...(r.max_delivery_days != null ? { maxDeliveryDays: r.max_delivery_days } : {}),
            })),
          ),
        ),

      getVariantPrices: (variantId, currency) =>
        get(
          `/v2/catalog-variants/${variantId}/prices?currency=${encodeURIComponent(currency)}`,
          Envelope(PricesWire),
        ).pipe(
          Effect.map(({ data }): VariantPrices => ({
            currency: data.currency,
            byTechnique: Object.fromEntries(
              data.variant.techniques.map((t) => [
                t.technique_key,
                toMinorUnits(t.discounted_price ?? t.price, data.currency),
              ]),
            ),
            placementSurcharge: Object.fromEntries(
              (data.product?.placements ?? []).map((p) => [
                `${p.id}/${p.technique_key}`,
                toMinorUnits(p.discounted_price ?? p.price, data.currency),
              ]),
            ),
          })),
        ),

      getCatalogProduct: (id) =>
        get(`/v2/catalog-products/${id}`, Envelope(ProductWire)).pipe(
          Effect.map(({ data }): CatalogProduct => ({
            id: data.id,
            name: data.name,
            printMethods: data.placements.map((p) => ({
              placement: p.placement,
              technique: p.technique,
            })),
          })),
        ),

      getCatalogVariant: (id) =>
        get(`/v2/catalog-variants/${id}`, Envelope(VariantWire)).pipe(
          Effect.map(({ data }): CatalogVariant => ({
            id: data.id,
            catalogProductId: data.catalog_product_id,
            name: data.name,
            ...(data.size ? { size: data.size } : {}),
            ...(data.color ? { color: data.color } : {}),
            ...(data.image ? { imageUrl: data.image } : {}),
            placementDimensions: data.placement_dimensions.map((d) => ({
              placement: d.placement,
              widthIn: d.width,
              heightIn: d.height,
              orientation: d.orientation ?? 'any',
            })),
          })),
        ),

      getPlacementPrintAreas: (productId) =>
        get(
          `/v2/catalog-products/${productId}/mockup-styles`,
          Envelope(Schema.Array(MockupStyleWire)),
        ).pipe(
          Effect.map(({ data }) =>
            data.map((s): PlacementPrintArea => ({
              placement: s.placement,
              technique: s.technique,
              printAreaWidthIn: s.print_area_width,
              printAreaHeightIn: s.print_area_height,
              dpi: s.dpi,
            })),
          ),
        ),
    };
    return service;
  });

export const layerPrintful = (options: PrintfulOptions) =>
  Layer.effect(FulfilmentProvider, makePrintful(options));
