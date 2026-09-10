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
  type ShippingRate,
  type VariantPrices,
} from './fulfilment-provider';
import { toMinorUnits } from '../quote/money';

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
  rate: Schema.String,
  currency: Schema.String,
  min_delivery_days: Schema.optional(Schema.NullOr(Schema.Number)),
  max_delivery_days: Schema.optional(Schema.NullOr(Schema.Number)),
});

const PricesWire = Schema.Struct({
  currency: Schema.String,
  variant: Schema.Struct({
    id: Schema.Number,
    techniques: Schema.Array(
      Schema.Struct({
        technique_key: Schema.String,
        price: Schema.String,
        discounted_price: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  }),
});

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
          // Printful answers 400 for a destination it cannot ship to; that is "no options", not an outage.
          Effect.catchIf(
            (e) => e.status === 400,
            () => Effect.succeed({ data: [] as ReadonlyArray<typeof ShippingRateWire.Type> }),
          ),
          Effect.map(({ data }) =>
            data.map((r): ShippingRate => ({
              method: r.shipping,
              name: r.shipping_method_name.trim(),
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
