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
  type ShippingRate,
  type ShippingRateRequest,
  type VariantPrices,
} from './fulfilment-provider';
import { Mailer, type Email } from './mailer';
import { Psp, PspError, type CheckoutSession, type CheckoutSessionInput } from './psp';

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

/** Records every session request so tests can assert what the PSP was asked to do. */
export const makePspMemory = Effect.map(
  Ref.make<ReadonlyArray<{ input: CheckoutSessionInput; session: CheckoutSession }>>([]),
  (ref) => {
    let down = false;
    return {
      setDown: (d: boolean) => void (down = d),
      layer: Layer.succeed(Psp, {
        health: () => Effect.void,
        createCheckoutSession: (input) =>
          down
            ? Effect.fail(new PspError({ message: 'PSP unreachable', retryable: true }))
            : Ref.modify(ref, (all) => {
                const session: CheckoutSession = {
                  id: `cs_test_${all.length + 1}`,
                  url: `https://checkout.stripe.test/c/pay/cs_test_${all.length + 1}`,
                  expiresAt: input.expiresAt,
                };
                return [session, [...all, { input, session }]];
              }),
      }),
      sessions: Ref.get(ref),
    };
  },
);

export const layerPspMemory = Layer.unwrapEffect(Effect.map(makePspMemory, (m) => m.layer));

export interface MemoryCatalog {
  readonly products: ReadonlyArray<CatalogProduct>;
  readonly variants: ReadonlyArray<CatalogVariant>;
  readonly printAreas: Readonly<Record<number, ReadonlyArray<PlacementPrintArea>>>;
  /** Shipping rates by destination country code; a country absent here cannot be shipped to. */
  readonly shippingRates?: Readonly<Record<string, ReadonlyArray<ShippingRate>>>;
  /** Operator cost per variant. */
  readonly prices?: Readonly<Record<number, VariantPrices>>;
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
export const makeFulfilmentProviderMemory = (catalog: MemoryCatalog = emptyCatalog) =>
  Effect.map(Ref.make(0), (calls) => {
    const counted = <A>(what: string, id: number, item: A | undefined) =>
      Ref.update(calls, (n) => n + 1).pipe(
        Effect.flatMap(() => (item ? Effect.succeed(item) : notFound(what, id))),
      );
    return {
      layer: Layer.succeed(FulfilmentProvider, {
        health: () => Effect.void,
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
        getShippingRates: (req: ShippingRateRequest) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.map(() => catalog.shippingRates?.[req.countryCode] ?? []),
          ),
        getVariantPrices: (variantId) =>
          counted('catalog variant prices', variantId, catalog.prices?.[variantId]),
      }),
      calls: Ref.get(calls),
    };
  });

export const layerFulfilmentProviderMemory = Layer.unwrapEffect(
  Effect.map(makeFulfilmentProviderMemory(), (m) => m.layer),
);

/** Records sends so tests can read what was sent. */
export const makeMailerMemory = Effect.map(Ref.make<ReadonlyArray<Email>>([]), (ref) => ({
  layer: Layer.succeed(Mailer, {
    send: (email) => Ref.update(ref, (sent) => [...sent, email]),
  }),
  sent: Ref.get(ref),
}));
