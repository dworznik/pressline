import type { CatalogueVariant } from '@pressline/contract';
import { Clock, Effect, Schema } from 'effect';
import { Config } from '../config/schema';
import { Db } from '../db/db';
import { loadDesign } from '../design/design';
import { FulfilmentProvider, type ShippingRate } from '../services/fulfilment-provider';
import { withMarkup } from './money';

/**
 * Quote (CONTEXT.md, ADR-0010): the locked price for one Order — Offer retail
 * price plus the provider's live shipping rate for the chosen country, tax
 * added later by the PSP. The provider's product and shipping cost are kept
 * alongside as the Provider Cost Estimate; they never change the price.
 */
export const QuoteRequest = Schema.Struct({
  engine: Schema.String,
  designId: Schema.String,
  offer: Schema.String,
  variant: Schema.String,
  /** ISO 3166-1 alpha-2. */
  country: Schema.String.pipe(Schema.pattern(/^[A-Z]{2}$/)),
  /** Required by the provider for US, CA and AU. */
  state: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Z0-9]{1,3}$/i))),
});
export type QuoteRequest = typeof QuoteRequest.Type;

export const Money = Schema.Struct({ amount: Schema.Int, currency: Schema.String });

export const Quote = Schema.Struct({
  id: Schema.String,
  engine: Schema.String,
  designId: Schema.String,
  offer: Schema.String,
  variant: Schema.String,
  specHash: Schema.String,
  country: Schema.String,
  state: Schema.optional(Schema.String),
  currency: Schema.String,
  /** Offer retail price, minor units. */
  retail: Schema.Int,
  /** Shipping line the Customer pays: provider rate plus the configured markup. */
  shipping: Schema.Int,
  /** retail + shipping; tax is added by the PSP at payment. */
  total: Schema.Int,
  shippingMethod: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    minDeliveryDays: Schema.optional(Schema.Int),
    maxDeliveryDays: Schema.optional(Schema.Int),
  }),
  providerCostEstimate: Schema.Struct({
    product: Schema.Int,
    shipping: Schema.Int,
    currency: Schema.String,
  }),
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
});
export type Quote = typeof Quote.Type;

export class QuoteUnavailable extends Schema.TaggedError<QuoteUnavailable>()('QuoteUnavailable', {
  reason: Schema.Literal('not_sellable', 'not_eligible', 'state_required', 'no_shipping'),
  message: Schema.String,
}) {}

export class QuoteNotFound extends Schema.TaggedError<QuoteNotFound>()('QuoteNotFound', {
  id: Schema.String,
}) {}

const STATE_REQUIRED = new Set(['US', 'CA', 'AU']);

/** Prefer the provider's standard method; otherwise the cheapest. */
const chooseRate = (rates: ReadonlyArray<ShippingRate>) =>
  rates.find((r) => r.method === 'STANDARD') ??
  [...rates].sort((a, b) => a.rate.amount - b.rate.amount)[0];

const persist = (q: Quote) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.run(
      `INSERT INTO quotes (id, engine, design_id, offer_slug, variant_key, spec_hash, country, state, currency,
         retail, shipping, shipping_method, shipping_method_name, cost_product, cost_shipping, cost_currency, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        q.id,
        q.engine,
        q.designId,
        q.offer,
        q.variant,
        q.specHash,
        q.country,
        q.state ?? null,
        q.currency,
        q.retail,
        q.shipping,
        q.shippingMethod.id,
        q.shippingMethod.name,
        q.providerCostEstimate.product,
        q.providerCostEstimate.shipping,
        q.providerCostEstimate.currency,
        q.createdAt,
        q.expiresAt,
      ],
    );
  }).pipe(Effect.orDie);

type Row = {
  id: string;
  engine: string;
  design_id: string;
  offer_slug: string;
  variant_key: string;
  spec_hash: string;
  country: string;
  state: string | null;
  currency: string;
  retail: number;
  shipping: number;
  shipping_method: string;
  shipping_method_name: string;
  cost_product: number;
  cost_shipping: number;
  cost_currency: string;
  created_at: number;
  expires_at: number;
};

const fromRow = (r: Row): Quote => ({
  id: r.id,
  engine: r.engine,
  designId: r.design_id,
  offer: r.offer_slug,
  variant: r.variant_key,
  specHash: r.spec_hash,
  country: r.country,
  ...(r.state ? { state: r.state } : {}),
  currency: r.currency,
  retail: r.retail,
  shipping: r.shipping,
  total: r.retail + r.shipping,
  shippingMethod: { id: r.shipping_method, name: r.shipping_method_name },
  providerCostEstimate: {
    product: r.cost_product,
    shipping: r.cost_shipping,
    currency: r.cost_currency,
  },
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

/** A stored Quote by id (used by checkout, ticket #8). */
export const findQuote = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* db.all<Row>('SELECT * FROM quotes WHERE id = ?', [id]).pipe(Effect.orDie);
    return rows[0] ? fromRow(rows[0]) : yield* new QuoteNotFound({ id });
  });

export const makeQuote = (req: QuoteRequest) =>
  Effect.gen(function* () {
    const country = req.country.toUpperCase();
    const state = req.state?.toUpperCase();
    if (STATE_REQUIRED.has(country) && !state) {
      return yield* new QuoteUnavailable({
        reason: 'state_required',
        message: `A state or province is required for ${country}.`,
      });
    }

    const page = yield* loadDesign(req.engine, req.designId);
    if (!page.design.sellable) {
      return yield* new QuoteUnavailable({
        reason: 'not_sellable',
        message: 'This design is no longer available to order.',
      });
    }
    const offer = page.offers.find((o) => o.slug === req.offer);
    const variant: CatalogueVariant | undefined = offer?.variants.find(
      (v) => v.key === req.variant,
    );
    if (!offer || !variant) {
      return yield* new QuoteUnavailable({
        reason: 'not_eligible',
        message: 'This product is not available for this design.',
      });
    }

    const config = yield* Config;
    const offerConfig = config.catalogue.offers.find((o) => o.slug === offer.slug)!;
    const catalogVariantId = offerConfig.variants[variant.key]!.catalogVariantId;
    const provider = yield* FulfilmentProvider;

    const rates = yield* provider.getShippingRates({
      countryCode: country,
      ...(state ? { stateCode: state } : {}),
      items: [{ catalogVariantId, quantity: 1 }],
      currency: config.currency,
    });
    const rate = chooseRate(rates);
    if (!rate) {
      return yield* new QuoteUnavailable({
        reason: 'no_shipping',
        message: `We cannot ship this product to ${country}.`,
      });
    }
    const prices = yield* provider.getVariantPrices(catalogVariantId, config.currency);
    const productCost = prices.byTechnique[offer.technique] ?? 0;

    const now = yield* Clock.currentTimeMillis;
    const shipping = withMarkup(rate.rate.amount, config.shipping.markupPercent);
    const quote: Quote = {
      id: crypto.randomUUID(),
      engine: req.engine,
      designId: req.designId,
      offer: offer.slug,
      variant: variant.key,
      specHash: variant.specHash,
      country,
      ...(state ? { state } : {}),
      currency: config.currency,
      retail: offer.retailPrice.amount,
      shipping,
      total: offer.retailPrice.amount + shipping,
      shippingMethod: {
        id: rate.method,
        name: rate.name,
        ...(rate.minDeliveryDays !== undefined ? { minDeliveryDays: rate.minDeliveryDays } : {}),
        ...(rate.maxDeliveryDays !== undefined ? { maxDeliveryDays: rate.maxDeliveryDays } : {}),
      },
      providerCostEstimate: {
        product: productCost,
        shipping: rate.rate.amount,
        currency: rate.rate.currency,
      },
      createdAt: now,
      expiresAt: now + config.quote.ttlMs,
    };
    yield* persist(quote);
    return quote;
  });
