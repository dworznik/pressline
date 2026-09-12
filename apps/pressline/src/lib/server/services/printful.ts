import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import type { HttpClientError } from '@effect/platform';

import { Duration, Effect, Layer, Schema } from 'effect';
import {
  FulfillmentProvider,
  FulfillmentProviderError,
  type CatalogProduct,
  type CatalogVariant,
  type FulfillmentProviderService,
  type PlacementPrintArea,
  type ProviderOrder,
  type ProviderOrderStatus,
  type ProviderRecipient,
  type ProviderShipment,
  type ProviderWebhookEvent,
  ProviderWebhookRejected,
  type ShippingRate,
  type VariantPrices,
} from './fulfillment-provider';
import { DecimalString, toMinorUnits } from '../money';

/**
 * Printful API v2 adapter (ADR-0007). The only place Printful's wire shapes
 * appear. Decoding is lenient (only the fields we use are required) so a
 * beta-time field shuffle degrades to a FulfillmentProviderError, not a crash.
 */
export interface PrintfulOptions {
  readonly token: string;
  readonly baseUrl?: string;
  /** Bound on one request including body decoding; a stall is a retryable error. */
  readonly timeout?: Duration.DurationInput;
  /** Hex secret returned when the webhook configuration was created; required to accept webhooks. */
  readonly webhookSecret?: string;
  /** Public key of that configuration; when set, deliveries for another configuration are rejected. */
  readonly webhookPublicKey?: string;
}

const WebhookWire = Schema.Struct({
  type: Schema.String,
  occurred_at: Schema.String,
  retries: Schema.optional(Schema.Number),
  store_id: Schema.optional(Schema.Number),
  data: Schema.optionalWith(
    Schema.Struct({
      order: Schema.optional(
        Schema.Struct({
          id: Schema.Number,
          external_id: Schema.optional(Schema.NullOr(Schema.String)),
          status: Schema.optional(Schema.String),
        }),
      ),
      shipment: Schema.optional(
        Schema.Struct({ id: Schema.Number, status: Schema.optional(Schema.String) }),
      ),
    }),
    { default: () => ({}) },
  ),
});

const ShipmentWire = Schema.Struct({
  id: Schema.Number,
  carrier: Schema.optional(Schema.NullOr(Schema.String)),
  service: Schema.optional(Schema.NullOr(Schema.String)),
  shipment_status: Schema.String,
  shipped_at: Schema.optional(Schema.NullOr(Schema.String)),
  tracking_number: Schema.optional(Schema.NullOr(Schema.String)),
  tracking_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const SHIPMENT_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'onhold',
  'canceled',
  'packaged',
  'shipped',
  'returned',
  'outstock',
]);

const hexToBytes = (hex: string) =>
  Uint8Array.from(hex.match(/.{1,2}/g) ?? [], (b) => parseInt(b, 16));
const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** HMAC-SHA256 over the raw body with the hex-decoded secret, hex digest in `x-pf-webhook-signature`. */
const hmacHex = (secretHex: string, body: string) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(secretHex),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  });

/** Printful sends no event id; derive a stable one so retries of the same event are duplicates. */
const eventIdOf = (e: typeof WebhookWire.Type) =>
  Effect.promise(async () => {
    const material = `${e.type}|${e.occurred_at}|${e.data.order?.id ?? ''}|${e.data.shipment?.id ?? ''}`;
    return bytesToHex(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)),
    ).slice(0, 32);
  });

export const DEFAULT_TIMEOUT: Duration.DurationInput = '15 seconds';

const CATALOG_PAGE = 100;

const toRecipientWire = (r: ProviderRecipient) => ({
  name: r.name,
  address1: r.address1,
  ...(r.address2 ? { address2: r.address2 } : {}),
  city: r.city,
  ...(r.stateCode ? { state_code: r.stateCode } : {}),
  country_code: r.countryCode,
  ...(r.zip ? { zip: r.zip } : {}),
  email: r.email,
  ...(r.phone ? { phone: r.phone } : {}),
});

/** Order and shipment events the webhook handler acts on (webhooks/printful.ts); all are configurable event types in v2. */
export const PRINTFUL_WEBHOOK_EVENTS = [
  'order_created',
  'order_updated',
  'order_failed',
  'order_canceled',
  'order_put_hold',
  'order_remove_hold',
  'shipment_sent',
  'shipment_returned',
  'shipment_canceled',
] as const;

const WebhookInfoWire = Schema.Struct({
  default_url: Schema.optional(Schema.NullOr(Schema.String)),
  events: Schema.optional(
    Schema.Array(
      Schema.Struct({ type: Schema.String, url: Schema.optional(Schema.NullOr(Schema.String)) }),
    ),
  ),
});

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

const toCatalogVariant = (data: typeof VariantWire.Type): CatalogVariant => ({
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

/** While `calculation_status` is `calculating` (a fresh draft), every money field, the currency included, is `null`. */
const OrderCostsWire = Schema.Struct({
  calculation_status: Schema.optional(Schema.String),
  currency: Schema.NullOr(Schema.String),
  subtotal: Schema.optional(Schema.NullOr(DecimalString)),
  shipping: Schema.optional(Schema.NullOr(DecimalString)),
  tax: Schema.optional(Schema.NullOr(DecimalString)),
  vat: Schema.optional(Schema.NullOr(DecimalString)),
  total: Schema.optional(Schema.NullOr(DecimalString)),
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

/**
 * Printful caps `external_id` at 32 characters; an Order id is a 36-character
 * UUID. Send it without hyphens and put them back on the way in, so the rest
 * of the bridge keeps talking in Order ids.
 */
const toExternalId = (orderId: string) => orderId.replaceAll('-', '');
const fromExternalId = (externalId: string) =>
  /^[0-9a-f]{32}$/i.test(externalId)
    ? externalId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
    : externalId;

const toProviderOrder = (o: typeof OrderWire.Type): ProviderOrder => {
  const costs = o.costs ?? undefined;
  return {
    id: String(o.id),
    ...(o.external_id ? { externalId: fromExternalId(o.external_id) } : {}),
    status: (ORDER_STATUSES.has(o.status) ? o.status : 'unknown') as ProviderOrderStatus,
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
    // No currency yet means nothing is priced yet: report no costs rather than zeros.
    ...(costs && costs.currency
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

const toFulfillmentProviderError = (
  e: HttpClientError.HttpClientError | FulfillmentProviderError,
): FulfillmentProviderError => {
  if (e instanceof FulfillmentProviderError) return e;
  return new FulfillmentProviderError({ message: `Printful: ${e.message}`, retryable: true });
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
      // Printful refuses to confirm a draft while its cost calculation runs (a 400); that clears in seconds.
      const retryable =
        res.status === 429 || res.status >= 500 || /cost calculations still running/i.test(detail);
      return new FulfillmentProviderError({
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
                    new FulfillmentProviderError({
                      message: `Printful ${path}: ${e.message}`,
                      retryable: false,
                    }),
                ),
              )
            : failStatus(res),
        ),
        Effect.mapError(toFulfillmentProviderError),
        Effect.scoped,
        // Bounds the request and the body decode together; a stall is retryable.
        Effect.timeoutFail({
          duration: timeout,
          onTimeout: () =>
            new FulfillmentProviderError({
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
            new FulfillmentProviderError({
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
                    new FulfillmentProviderError({
                      message: `Printful ${path}: ${e.message}`,
                      retryable: false,
                    }),
                ),
              )
            : failStatus(res),
        ),
        Effect.mapError(toFulfillmentProviderError),
        Effect.scoped,
        Effect.timeoutFail({
          duration: timeout,
          onTimeout: () =>
            new FulfillmentProviderError({
              message: `Printful ${path}: no response within ${Duration.format(timeout)}`,
              retryable: true,
            }),
        }),
      );

    const patch = <A, I>(path: string, body: unknown, schema: Schema.Schema<A, I>) =>
      HttpClientRequest.patch(path).pipe(
        HttpClientRequest.bodyJson(body),
        Effect.mapError(
          (e) =>
            new FulfillmentProviderError({
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
                    new FulfillmentProviderError({
                      message: `Printful ${path}: ${e.message}`,
                      retryable: false,
                    }),
                ),
              )
            : failStatus(res),
        ),
        Effect.mapError(toFulfillmentProviderError),
        Effect.scoped,
        Effect.timeoutFail({
          duration: timeout,
          onTimeout: () =>
            new FulfillmentProviderError({
              message: `Printful ${path}: no response within ${Duration.format(timeout)}`,
              retryable: true,
            }),
        }),
      );

    const parseWebhook = (rawBody: string) =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(Schema.parseJson(WebhookWire))(rawBody).pipe(
          Effect.mapError(
            (e) => new ProviderWebhookRejected({ message: `unreadable event: ${e.message}` }),
          ),
        );
        const occurredAt = Math.floor(Date.parse(parsed.occurred_at) / 1000);
        return {
          id: yield* eventIdOf(parsed),
          type: parsed.type,
          occurredAt: Number.isFinite(occurredAt) ? occurredAt : 0,
          ...(parsed.data.order ? { providerOrderId: String(parsed.data.order.id) } : {}),
          ...(parsed.data.order?.external_id
            ? { orderExternalId: fromExternalId(parsed.data.order.external_id) }
            : {}),
          ...(parsed.data.shipment ? { shipmentId: String(parsed.data.shipment.id) } : {}),
        } satisfies ProviderWebhookEvent;
      });

    const service: FulfillmentProviderService = {
      health: () => get('/v2/catalog-products?limit=1', Schema.Unknown).pipe(Effect.asVoid),

      getWebhookStatus: () =>
        get(
          '/v2/webhooks',
          Envelope(
            Schema.Struct({
              default_url: Schema.optional(Schema.NullOr(Schema.String)),
              events: Schema.optional(
                Schema.Array(
                  Schema.Struct({
                    type: Schema.String,
                    url: Schema.optional(Schema.NullOr(Schema.String)),
                  }),
                ),
              ),
            }),
          ),
        ).pipe(
          Effect.map(({ data }) => {
            const url = data.default_url ?? data.events?.find((e) => e.url)?.url ?? undefined;
            const configured = !!url && /\/webhooks\/printful$/.test(url);
            return {
              configured,
              ...(url ? { url } : {}),
              ...(configured ? {} : { detail: url ? 'points elsewhere' : 'no configuration' }),
            };
          }),
          Effect.catchIf(
            (e) => e.status === 404,
            () => Effect.succeed({ configured: false, detail: 'no configuration' }),
          ),
        ),

      verifyWebhook: (rawBody, headers) =>
        Effect.gen(function* () {
          if (!options.webhookSecret) {
            return yield* new ProviderWebhookRejected({
              message: 'PRINTFUL_WEBHOOK_SECRET is not configured',
            });
          }
          if (!headers.signature)
            return yield* new ProviderWebhookRejected({
              message: 'missing x-pf-webhook-signature',
            });
          if (options.webhookPublicKey && headers.publicKey !== options.webhookPublicKey) {
            return yield* new ProviderWebhookRejected({
              message: 'delivery is for another webhook configuration',
            });
          }
          const expected = yield* hmacHex(options.webhookSecret, rawBody);
          if (!timingSafeEqual(expected, headers.signature.toLowerCase())) {
            return yield* new ProviderWebhookRejected({ message: 'signature mismatch' });
          }
          return yield* parseWebhook(rawBody);
        }),

      parseWebhook,

      listShipments: (providerOrderId) =>
        get(
          `/v2/orders/${encodeURIComponent(providerOrderId)}/shipments?limit=100`,
          Envelope(Schema.Array(ShipmentWire)),
        ).pipe(
          Effect.map(({ data }) =>
            data.map((sh): ProviderShipment => ({
              id: String(sh.id),
              status: (SHIPMENT_STATUSES.has(sh.shipment_status)
                ? sh.shipment_status
                : 'pending') as ProviderShipment['status'],
              ...(sh.carrier ? { carrier: sh.carrier } : {}),
              ...(sh.service ? { service: sh.service } : {}),
              ...(sh.tracking_number ? { trackingNumber: sh.tracking_number } : {}),
              ...(sh.tracking_url ? { trackingUrl: sh.tracking_url } : {}),
              ...(sh.shipped_at ? { shippedAt: sh.shipped_at } : {}),
            })),
          ),
        ),

      findOrderByExternalId: (externalId) =>
        get(
          `/v2/orders/@${encodeURIComponent(toExternalId(externalId))}`,
          Envelope(OrderWire),
        ).pipe(
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
            external_id: toExternalId(d.externalId),
            shipping: d.shippingMethod,
            recipient: toRecipientWire(d.recipient),
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

      cancelOrder: (id) =>
        HttpClientRequest.del(`/v2/orders/${encodeURIComponent(id)}`).pipe(
          client.execute,
          Effect.flatMap((res) =>
            res.status >= 200 && res.status < 300
              ? Effect.succeed('canceled' as const)
              : // Printful refuses to delete an order it has started on (409); that is an answer, not a failure.
                res.status === 409
                ? Effect.succeed('not_cancelable' as const)
                : failStatus(res),
          ),
          Effect.mapError(toFulfillmentProviderError),
          Effect.scoped,
        ),

      updateOrderRecipient: (id, recipient) =>
        patch(
          `/v2/orders/${encodeURIComponent(id)}`,
          { recipient: toRecipientWire(recipient) },
          Envelope(OrderWire),
        ).pipe(Effect.map(({ data }) => toProviderOrder(data))),

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
          Effect.map(({ data }) => toCatalogVariant(data)),
        ),

      listCatalogProducts: () =>
        Effect.gen(function* () {
          const all: CatalogProduct[] = [];
          for (let offset = 0; ; offset += CATALOG_PAGE) {
            const { data } = yield* get(
              `/v2/catalog-products?limit=${CATALOG_PAGE}&offset=${offset}`,
              Envelope(Schema.Array(ProductWire)),
            );
            for (const p of data) {
              all.push({
                id: p.id,
                name: p.name,
                printMethods: p.placements.map((pl) => ({
                  placement: pl.placement,
                  technique: pl.technique,
                })),
              });
            }
            if (data.length < CATALOG_PAGE) return all;
          }
        }),

      listCatalogVariants: (productId) =>
        Effect.gen(function* () {
          const all: CatalogVariant[] = [];
          for (let offset = 0; ; offset += CATALOG_PAGE) {
            const { data } = yield* get(
              `/v2/catalog-products/${productId}/catalog-variants?limit=${CATALOG_PAGE}&offset=${offset}`,
              Envelope(Schema.Array(VariantWire)),
            );
            all.push(...data.map(toCatalogVariant));
            if (data.length < CATALOG_PAGE) return all;
          }
        }),

      registerWebhook: (url) =>
        Effect.gen(function* () {
          const current = yield* get('/v2/webhooks', Envelope(WebhookInfoWire)).pipe(
            Effect.map(({ data }) => data),
            Effect.catchIf(
              (e) => e.status === 404,
              () => Effect.succeed(undefined),
            ),
          );
          const configuredTypes = new Set(current?.events?.map((e) => e.type) ?? []);
          const verified =
            current?.default_url === url &&
            PRINTFUL_WEBHOOK_EVENTS.every((t) => configuredTypes.has(t));
          if (verified) return { status: 'verified' as const, url };
          const { data } = yield* post(
            '/v2/webhooks',
            {
              default_url: url,
              expires_at: null,
              events: PRINTFUL_WEBHOOK_EVENTS.map((type) => ({ type })),
            },
            Envelope(
              Schema.Struct({
                secret_key: Schema.optional(Schema.String),
                public_key: Schema.optional(Schema.String),
              }),
            ),
          );
          return {
            status: 'created' as const,
            url,
            ...(data.secret_key ? { secret: data.secret_key } : {}),
            ...(data.public_key ? { publicKey: data.public_key } : {}),
          };
        }),

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
  Layer.effect(FulfillmentProvider, makePrintful(options));
