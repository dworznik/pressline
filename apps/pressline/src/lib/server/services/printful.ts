import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import type { HttpClientError } from '@effect/platform';
import { Effect, Layer, Schema } from 'effect';
import {
  FulfilmentProvider,
  FulfilmentProviderError,
  type CatalogProduct,
  type CatalogVariant,
  type FulfilmentProviderService,
  type PlacementPrintArea,
} from './fulfilment-provider';

/**
 * Printful API v2 adapter (ADR-0007). The only place Printful's wire shapes
 * appear. Decoding is lenient (only the fields we use are required) so a
 * beta-time field shuffle degrades to a FulfilmentProviderError, not a crash.
 */
export interface PrintfulOptions {
  readonly token: string;
  readonly baseUrl?: string;
}

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
      );

    const service: FulfilmentProviderService = {
      health: () => get('/v2/catalog-products?limit=1', Schema.Unknown).pipe(Effect.asVoid),

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
