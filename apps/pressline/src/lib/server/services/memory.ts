import {
  DesignNotFound,
  PrintfileRejected,
  PROTOCOL_VERSION,
  specHash,
  type DesignResponse,
  type PrintfileReady,
  type PrintfileRendering,
  type PrintfileSpec,
} from '@pressline/contract';
import { Effect, Layer, Ref } from 'effect';
import { DesignSource, DesignSourceError, UnknownEngine } from './design-source';
import {
  FulfilmentProvider,
  FulfilmentProviderError,
  type CatalogProduct,
  type CatalogVariant,
  type PlacementPrintArea,
  type ProviderOrder,
  type ProviderOrderDraft,
  type ProviderShipment,
  type ProviderWebhookEvent,
  ProviderWebhookRejected,
  type ShippingRate,
  type ShippingRateRequest,
  type VariantPrices,
} from './fulfilment-provider';
import { Mailer, MailerError, type Email } from './mailer';
import {
  Psp,
  PspError,
  WebhookRejected,
  type CheckoutSession,
  type CheckoutSessionDetails,
  type CheckoutSessionInput,
  type PaymentStatus,
} from './psp';

/**
 * In-memory implementations of every external service. The test harness
 * uses all of them; production boot uses the provider and PSP stand-ins until
 * an Operator has configured the real ones. Kept apart from the production
 * modules so test-double changes never touch them.
 */

/** How the in-memory Engine answers ensure-Printfile for one Design. */
export type MemoryPrintfileAnswer =
  | {
      readonly kind: 'ready';
      readonly url: string;
      readonly bytes?: number;
      readonly sha256?: string;
      readonly contentType?: PrintfileReady['contentType'];
      readonly specHash?: string;
      readonly width?: number;
      readonly height?: number;
    }
  /** Answer `rendering` this many times, then as `then`. */
  | {
      readonly kind: 'rendering';
      readonly times: number;
      readonly then: MemoryPrintfileAnswer;
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: 'rejected';
      readonly code: PrintfileRejected['code'];
      readonly message?: string;
    };

export interface MemoryEngine {
  readonly protocolVersion?: string;
  /** Unreachable: every call fails as a transport error. */
  readonly down?: boolean;
  readonly designs?: Readonly<Record<string, DesignResponse>>;
  /** Per Design ID; default answers `ready` with a synthetic URL. */
  readonly printfiles?: Readonly<Record<string, MemoryPrintfileAnswer>>;
}

export interface DesignSourceMemoryOptions {
  readonly protocolVersion?: string;
  readonly engines?: Readonly<Record<string, MemoryEngine>>;
}

/**
 * In-memory Engines: seeded designs and scripted render behaviour, plus a
 * call counter so tests can assert how often the Engine was asked.
 */
export const makeDesignSourceMemory = (options: DesignSourceMemoryOptions = {}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const remaining = new Map<string, number>();
    const engineOf = (slug: string): Effect.Effect<MemoryEngine, UnknownEngine> => {
      const e = options.engines?.[slug];
      return e ? Effect.succeed(e) : Effect.fail(new UnknownEngine({ engine: slug }));
    };
    const reachable = (slug: string, e: MemoryEngine) =>
      e.down
        ? Effect.fail(
            new DesignSourceError({
              engine: slug,
              message: `engine ${slug} unreachable`,
              retryable: true,
            }),
          )
        : Effect.void;
    const answer = (
      engine: string,
      designId: string,
      spec: PrintfileSpec,
      render: MemoryPrintfileAnswer,
    ): Effect.Effect<PrintfileReady | PrintfileRendering, PrintfileRejected> => {
      switch (render.kind) {
        case 'rejected':
          return Effect.fail(
            new PrintfileRejected({ code: render.code, message: render.message ?? render.code }),
          );
        case 'rendering': {
          const key = `${engine}/${designId}`;
          const left = remaining.get(key) ?? render.times;
          if (left > 0) {
            remaining.set(key, left - 1);
            return Effect.succeed({ status: 'rendering', retryAfterMs: render.retryAfterMs ?? 10 });
          }
          return answer(engine, designId, spec, render.then);
        }
        case 'ready':
          return specHash(spec).pipe(
            Effect.orDie,
            Effect.map((hash): PrintfileReady => ({
              status: 'ready',
              url: render.url,
              sha256: render.sha256 ?? 'a'.repeat(64),
              width: render.width ?? spec.width,
              height: render.height ?? spec.height,
              bytes: render.bytes ?? 1234,
              contentType: render.contentType ?? 'image/png',
              specHash: render.specHash ?? hash,
            })),
          );
      }
    };
    const layer = Layer.succeed(DesignSource, {
      health: (slug) =>
        engineOf(slug).pipe(
          Effect.tap((e) => reachable(slug, e)),
          Effect.map((e) => ({
            protocolVersion: e.protocolVersion ?? options.protocolVersion ?? PROTOCOL_VERSION,
          })),
        ),
      getDesign: (slug, designId) =>
        engineOf(slug).pipe(
          Effect.tap((e) => reachable(slug, e)),
          Effect.tap(() => Ref.update(calls, (n) => n + 1)),
          Effect.flatMap((e) => {
            const d = e.designs?.[designId];
            return d ? Effect.succeed(d) : Effect.fail(new DesignNotFound({ designId }));
          }),
        ),
      ensurePrintfile: (slug, designId, spec) =>
        engineOf(slug).pipe(
          Effect.tap((e) => reachable(slug, e)),
          Effect.tap(() => Ref.update(calls, (n) => n + 1)),
          Effect.flatMap(
            (
              e,
            ): Effect.Effect<
              PrintfileReady | PrintfileRendering,
              DesignNotFound | PrintfileRejected
            > => {
              if (!e.designs?.[designId]) return Effect.fail(new DesignNotFound({ designId }));
              const answerFor: MemoryPrintfileAnswer = e.printfiles?.[designId] ?? {
                kind: 'ready',
                url: `https://engine.test/files/${designId}/${spec.placement}.png`,
              };
              return answer(slug, designId, spec, answerFor);
            },
          ),
        ),
    });
    return { layer, calls: Ref.get(calls) };
  });

export const layerDesignSourceMemory = (options: DesignSourceMemoryOptions = {}) =>
  Layer.unwrapEffect(Effect.map(makeDesignSourceMemory(options), (m) => m.layer));

/** The in-memory PSP's idea of a webhook body; the signature header must be `memory:valid`. */
export interface MemoryWebhookBody {
  readonly id: string;
  readonly type: string;
  readonly created?: number;
  readonly sessionId?: string;
}

/**
 * Records every session request so tests can assert what the PSP was asked
 * to do, lets a test "complete" a session with the details a re-fetch would
 * return, and verifies webhooks with a fixed fake signature.
 */
const parsePspWebhook = (rawBody: string) => {
  try {
    const body = JSON.parse(rawBody) as MemoryWebhookBody;
    return Effect.succeed({
      id: body.id,
      type: body.type,
      created: body.created ?? Math.floor(Date.now() / 1000),
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    });
  } catch {
    return Effect.fail(new WebhookRejected({ message: 'not JSON' }));
  }
};

export const makePspMemory = Effect.gen(function* () {
  const ref = yield* Ref.make<
    ReadonlyArray<{ input: CheckoutSessionInput; session: CheckoutSession }>
  >([]);
  const details = new Map<string, CheckoutSessionDetails>();
  const payments = new Map<string, PaymentStatus>();
  let down = false;
  const layer = Layer.succeed(Psp, {
    health: () => Effect.void,
    getPaymentStatus: (paymentIntentId) =>
      down
        ? Effect.fail(new PspError({ message: 'PSP unreachable', retryable: true }))
        : Effect.succeed(
            payments.get(paymentIntentId) ?? {
              refunded: false,
              amountRefunded: 0,
              disputed: false,
            },
          ),
    getWebhookStatus: () =>
      Effect.succeed({ configured: true, url: 'https://pressline.test/webhooks/stripe' }),
    createCheckoutSession: (input) =>
      down
        ? Effect.fail(new PspError({ message: 'PSP unreachable', retryable: true }))
        : Ref.modify(ref, (all) => {
            const session: CheckoutSession = {
              id: `cs_test_${all.length + 1}`,
              url: `https://checkout.stripe.test/c/pay/cs_test_${all.length + 1}`,
              expiresAt: input.expiresAt,
            };
            details.set(session.id, {
              id: session.id,
              status: 'open',
              paymentStatus: 'unpaid',
              orderId: input.orderId,
              currency: input.currency,
              consentAccepted: false,
              customer: {},
            });
            return [session, [...all, { input, session }]];
          }),
    getCheckoutSession: (id) => {
      if (down) return Effect.fail(new PspError({ message: 'PSP unreachable', retryable: true }));
      const d = details.get(id);
      return d
        ? Effect.succeed(d)
        : Effect.fail(
            new PspError({
              message: `No such checkout session: ${id}`,
              retryable: false,
              status: 404,
            }),
          );
    },
    verifyWebhook: (rawBody, signature) =>
      signature !== 'memory:valid'
        ? Effect.fail(new WebhookRejected({ message: 'bad signature' }))
        : parsePspWebhook(rawBody),
    parseWebhook: parsePspWebhook,
  });
  return {
    layer,
    sessions: Ref.get(ref),
    setDown: (d: boolean) => void (down = d),
    /** What the PSP reports for a payment intent (refunds, disputes). */
    setPayment: (paymentIntentId: string, status: PaymentStatus) => {
      payments.set(paymentIntentId, status);
    },
    /** What a later re-fetch of this session returns (e.g. after the Customer paid). */
    setSession: (id: string, patch: Partial<CheckoutSessionDetails>) => {
      const current = details.get(id) ?? {
        id,
        status: 'open' as const,
        paymentStatus: 'unpaid' as const,
        consentAccepted: false,
        customer: {},
      };
      details.set(id, { ...current, ...patch });
    },
  };
});

export const layerPspMemory = Layer.unwrapEffect(Effect.map(makePspMemory, (m) => m.layer));

export interface MemoryCatalog {
  readonly products: ReadonlyArray<CatalogProduct>;
  readonly variants: ReadonlyArray<CatalogVariant>;
  readonly printAreas: Readonly<Record<number, ReadonlyArray<PlacementPrintArea>>>;
  /** Shipping rates by destination country code; a country absent here cannot be shipped to. */
  readonly shippingRates?: Readonly<Record<string, ReadonlyArray<ShippingRate>>>;
  /** Operator cost per variant. */
  readonly prices?: Readonly<Record<number, VariantPrices>>;
  /** How the provider behaves when Pressline submits orders. */
  readonly orders?: {
    /** Fail the next N create calls with a retryable error. */
    readonly createRetryableFailures?: number;
    /** Reject every create with a non-retryable error (address problem, bad file). */
    readonly createRejects?: string;
    /** Fail the next N confirm calls with a retryable error. */
    readonly confirmRetryableFailures?: number;
    /** Draft comes back with this country instead of the recipient's (simulates a mismatch). */
    readonly draftCountryOverride?: string;
    /** Draft comes back holding this variant instead of the requested one. */
    readonly draftVariantOverride?: number;
    /** Draft comes back with a failed placement explanation. */
    readonly placementFailure?: string;
  };
}

export const emptyCatalog: MemoryCatalog = { products: [], variants: [], printAreas: {} };

const notFound = (what: string, id: number) =>
  new FulfilmentProviderError({
    message: `${what} ${id} not found`,
    retryable: false,
    status: 404,
  });

/**
 * Serves a seeded catalog and counts every call, so HTTP-seam tests can
 * assert that a cache hit does not reach the provider.
 */
const parseProviderWebhook = (rawBody: string) => {
  try {
    const b = JSON.parse(rawBody) as {
      type: string;
      occurred_at?: string;
      data?: {
        order?: { id: number | string; external_id?: string };
        shipment?: { id: number | string };
      };
    };
    const occurredAt = b.occurred_at
      ? Math.floor(Date.parse(b.occurred_at) / 1000)
      : Math.floor(Date.now() / 1000);
    const event: ProviderWebhookEvent = {
      id: `${b.type}|${b.occurred_at ?? ''}|${b.data?.order?.id ?? ''}|${b.data?.shipment?.id ?? ''}`,
      type: b.type,
      occurredAt,
      ...(b.data?.order ? { providerOrderId: String(b.data.order.id) } : {}),
      ...(b.data?.order?.external_id ? { orderExternalId: b.data.order.external_id } : {}),
      ...(b.data?.shipment ? { shipmentId: String(b.data.shipment.id) } : {}),
    };
    return Effect.succeed(event);
  } catch {
    return Effect.fail(new ProviderWebhookRejected({ message: 'not JSON' }));
  }
};

export const makeFulfilmentProviderMemory = (catalog: MemoryCatalog = emptyCatalog) =>
  Effect.map(Ref.make(0), (calls) => {
    const providerOrders = new Map<string, ProviderOrder>();
    const shipments = new Map<string, ReadonlyArray<ProviderShipment>>();
    let createFailuresLeft = catalog.orders?.createRetryableFailures ?? 0;
    let confirmFailuresLeft = catalog.orders?.confirmRetryableFailures ?? 0;
    const counted = <A>(what: string, id: number, item: A | undefined) =>
      Ref.update(calls, (n) => n + 1).pipe(
        Effect.flatMap(() => (item ? Effect.succeed(item) : notFound(what, id))),
      );
    return {
      layer: Layer.succeed(FulfilmentProvider, {
        health: () => Effect.void,
        getWebhookStatus: () =>
          Effect.succeed({ configured: true, url: 'https://pressline.test/webhooks/printful' }),
        getCatalogProduct: (id) =>
          counted(
            'catalog product',
            id,
            catalog.products.find((p) => p.id === id),
          ),
        getCatalogVariant: (id) =>
          counted(
            'catalog variant',
            id,
            catalog.variants.find((v) => v.id === id),
          ),
        getPlacementPrintAreas: (productId) =>
          counted('catalog product', productId, catalog.printAreas[productId]),
        verifyWebhook: (rawBody, headers) =>
          headers.signature !== 'memory:valid'
            ? Effect.fail(new ProviderWebhookRejected({ message: 'bad signature' }))
            : parseProviderWebhook(rawBody),
        parseWebhook: parseProviderWebhook,
        listShipments: (providerOrderId) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.map(() => shipments.get(providerOrderId) ?? []),
          ),
        findOrderByExternalId: (externalId) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.map(() => [...providerOrders.values()].find((o) => o.externalId === externalId)),
          ),
        createOrderDraft: (d: ProviderOrderDraft) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.flatMap(() => {
              const cfg = catalog.orders ?? {};
              if (cfg.createRejects) {
                return Effect.fail(
                  new FulfilmentProviderError({
                    message: cfg.createRejects,
                    retryable: false,
                    status: 400,
                  }),
                );
              }
              if (createFailuresLeft > 0) {
                createFailuresLeft -= 1;
                return Effect.fail(
                  new FulfilmentProviderError({
                    message: 'provider 503',
                    retryable: true,
                    status: 503,
                  }),
                );
              }
              const id = String(1000 + providerOrders.size);
              const order: ProviderOrder = {
                id,
                externalId: d.externalId,
                status: 'draft',
                recipient: {
                  countryCode: cfg.draftCountryOverride ?? d.recipient.countryCode,
                  ...(d.recipient.stateCode ? { stateCode: d.recipient.stateCode } : {}),
                },
                items: [
                  {
                    catalogVariantId: cfg.draftVariantOverride ?? d.item.catalogVariantId,
                    quantity: 1,
                    ...(cfg.placementFailure ? { failedPlacement: cfg.placementFailure } : {}),
                  },
                ],
                costs: {
                  currency: d.currency,
                  subtotal: 1090,
                  shipping: 479,
                  tax: 0,
                  total: 1569,
                  calculating: false,
                },
              };
              providerOrders.set(id, order);
              return Effect.succeed(order);
            }),
          ),
        confirmOrder: (id) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.flatMap(() => {
              const o = providerOrders.get(id);
              if (!o) return notFound('provider order', Number(id));
              if (confirmFailuresLeft > 0) {
                confirmFailuresLeft -= 1;
                return Effect.fail(
                  new FulfilmentProviderError({
                    message: 'provider 503',
                    retryable: true,
                    status: 503,
                  }),
                );
              }
              const confirmed: ProviderOrder = { ...o, status: 'pending' };
              providerOrders.set(id, confirmed);
              return Effect.succeed(confirmed);
            }),
          ),
        getOrder: (id) => {
          const o = providerOrders.get(id);
          return counted('provider order', Number(id), o);
        },
        cancelOrder: (id) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.flatMap(() => {
              const o = providerOrders.get(id);
              if (!o) return notFound('provider order', Number(id));
              providerOrders.set(id, { ...o, status: 'canceled' });
              return Effect.void;
            }),
          ),
        getShippingRates: (req: ShippingRateRequest) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.map(() => catalog.shippingRates?.[req.countryCode] ?? []),
          ),
        getVariantPrices: (variantId) =>
          counted('catalog variant prices', variantId, catalog.prices?.[variantId]),
      }),
      calls: Ref.get(calls),
      /** Provider-side orders as the in-memory provider holds them. */
      providerOrders: () => [...providerOrders.values()],
      /** Move a provider order (simulates Printful's dashboard or production). */
      setProviderOrderStatus: (id: string, status: ProviderOrder['status']) => {
        const o = providerOrders.get(id);
        if (o) providerOrders.set(id, { ...o, status });
      },
      /** What the provider reports as shipments for one of its orders. */
      setProviderShipments: (id: string, list: ReadonlyArray<ProviderShipment>) => {
        shipments.set(id, list);
      },
    };
  });

export const layerFulfilmentProviderMemory = Layer.unwrapEffect(
  Effect.map(makeFulfilmentProviderMemory(), (m) => m.layer),
);

/** Records sends so tests can read what was sent; can be switched to fail every send. */
export const makeMailerMemory = Effect.map(Ref.make<ReadonlyArray<Email>>([]), (ref) => {
  let down = false;
  return {
    layer: Layer.succeed(Mailer, {
      send: (email) =>
        down
          ? Effect.fail(new MailerError({ message: 'mailer unreachable', retryable: true }))
          : Ref.update(ref, (sent) => [...sent, email]).pipe(Effect.as(undefined)),
    }),
    sent: Ref.get(ref),
    setDown: (d: boolean) => void (down = d),
  };
});
