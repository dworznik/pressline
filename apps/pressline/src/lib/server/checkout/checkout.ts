import { Clock, Effect, Schema } from 'effect';
import { Config } from '../config/schema';
import { loadDesign } from '../design/design';
import { attachSession, createOrder, transition } from '../orders/orders';
import { statusToken, uuidv7 } from '../orders/ids';
import { findQuote } from '../quote/quote';
import { Psp } from '../services/psp';
import { findStored } from '../printfile/ensure';

/** Why checkout cannot start (422). */
export class CheckoutUnavailable extends Schema.TaggedError<CheckoutUnavailable>()(
  'CheckoutUnavailable',
  {
    reason: Schema.Literal('quote_expired', 'printfile_missing', 'not_sellable'),
    message: Schema.String,
  },
) {}

export const CheckoutRequest = Schema.Struct({ quoteId: Schema.String });
export type CheckoutRequest = typeof CheckoutRequest.Type;

export const CheckoutStarted = Schema.Struct({
  orderId: Schema.String,
  /** The PSP's hosted page; the Storefront redirects here. */
  url: Schema.String,
});

/** Stripe wants sessions to live 30 minutes to 24 hours; the spec (Storefront) chose 1 hour. */
export const SESSION_TTL_MS = 60 * 60_000;

/**
 * Start checkout for a Quote (ADR-0004, ADR-0009): refuse without a
 * validated Printfile, create the PSP session, and record the Order in
 * `checkout_open` so one ID threads Stripe, Printful and the ledger.
 */
export const startCheckout = (req: CheckoutRequest, origin: string) =>
  Effect.gen(function* () {
    const quote = yield* findQuote(req.quoteId);
    const now = yield* Clock.currentTimeMillis;
    if (quote.expiresAt <= now) {
      return yield* new CheckoutUnavailable({
        reason: 'quote_expired',
        message: 'This price has expired. Please get a new quote.',
      });
    }
    // The design must still be sellable and the Offer still eligible right now.
    const page = yield* loadDesign(quote.engine, quote.designId);
    const offer = page.offers.find((o) => o.slug === quote.offer);
    const variant = offer?.variants.find((v) => v.key === quote.variant);
    if (!page.design.sellable || !offer || !variant || variant.specHash !== quote.specHash) {
      return yield* new CheckoutUnavailable({
        reason: 'not_sellable',
        message: 'This design can no longer be ordered on this product.',
      });
    }
    const printfile = yield* findStored(quote.engine, quote.designId, quote.specHash);
    if (!printfile) {
      return yield* new CheckoutUnavailable({
        reason: 'printfile_missing',
        message: 'Your print file is not ready yet. Please wait a moment and try again.',
      });
    }

    const config = yield* Config;
    const psp = yield* Psp;
    const base = (config.checkout.publicUrl ?? origin).replace(/\/$/, '');
    const orderId = uuidv7(now);
    const token = statusToken();
    const expiresAt = Math.floor((now + SESSION_TTL_MS) / 1000);

    // The Order exists before the PSP session, so a session can never carry an
    // Order ID the ledger does not know (ADR-0009). If the PSP fails, the
    // Order is expired right away rather than left open.
    yield* createOrder(
      {
        id: orderId,
        statusToken: token,
        engine: quote.engine,
        designId: quote.designId,
        offer: quote.offer,
        variant: quote.variant,
        specHash: quote.specHash,
        printfile: {
          url: printfile.url,
          sha256: printfile.sha256,
          contentType: printfile.contentType,
        },
        quoteId: quote.id,
        currency: quote.currency,
        retail: quote.retail,
        shipping: quote.shipping,
        shippingMethod: { id: quote.shippingMethod.id, name: quote.shippingMethod.name },
        country: quote.country,
        providerCostEstimate: quote.providerCostEstimate,
        publicOrigin: base,
        previewUrl: page.design.previewUrl,
      },
      quote.id,
    );

    const session = yield* psp
      .createCheckoutSession({
        orderId,
        currency: quote.currency,
        product: {
          name: `${offer.name} · ${variant.label}`,
          ...(page.design.title ? { description: page.design.title } : {}),
          imageUrl: page.design.previewUrl,
          amount: quote.retail,
        },
        shipping: {
          name: quote.shippingMethod.name,
          amount: quote.shipping,
          ...(quote.shippingMethod.minDeliveryDays !== undefined
            ? { minDeliveryDays: quote.shippingMethod.minDeliveryDays }
            : {}),
          ...(quote.shippingMethod.maxDeliveryDays !== undefined
            ? { maxDeliveryDays: quote.shippingMethod.maxDeliveryDays }
            : {}),
        },
        allowedCountry: quote.country,
        consentText: config.legal.withdrawalNotice,
        successUrl: `${base}/orders/${orderId}/thank-you?t=${token}`,
        cancelUrl: `${base}/order/${quote.engine}/${quote.designId}?cancelled=1`,
        expiresAt,
        allowPromotionCodes: config.checkout.allowPromotionCodes,
      })
      .pipe(
        Effect.tapError(() =>
          transition(orderId, 'expired', 'storefront', 'psp_unavailable').pipe(Effect.ignore),
        ),
      );

    yield* attachSession(orderId, session.id, session.expiresAt * 1000);
    return { orderId, url: session.url };
  });
