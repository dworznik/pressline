import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import Stripe from 'stripe';
import {
  Psp,
  PspError,
  WebhookRejected,
  type CheckoutSessionDetails,
  type CheckoutSessionInput,
  type PspService,
} from './psp';

/**
 * Stripe Checkout adapter (ADR-0010). Hosted page, payment mode, automatic
 * tax, guest checkout, shipping country locked to the Quote's, consent to the
 * Withdrawal Notice collected by Stripe. Uses the official SDK over `fetch`
 * (so it runs on Workers) with WebCrypto for webhook signatures.
 */
export interface StripeOptions {
  readonly secretKey: string;
  /** Signing secret of the webhook endpoint (`whsec_…`); required to accept webhooks. */
  readonly webhookSecret?: string;
  /** Seconds of clock skew tolerated on webhook timestamps. */
  readonly webhookToleranceSeconds?: number;
}

const toSessionDetails = (s: Stripe.Checkout.Session): CheckoutSessionDetails => {
  const ship = s.collected_information?.shipping_details;
  const addr = ship?.address;
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  // The SDK types allow unknown future strings; anything else reads as the conservative value.
  const status: CheckoutSessionDetails['status'] =
    s.status === 'complete' ? 'complete' : s.status === 'expired' ? 'expired' : 'open';
  const paymentStatus: CheckoutSessionDetails['paymentStatus'] =
    s.payment_status === 'paid'
      ? 'paid'
      : s.payment_status === 'no_payment_required'
        ? 'no_payment_required'
        : 'unpaid';
  return {
    id: s.id,
    status,
    paymentStatus,
    ...(s.client_reference_id ? { orderId: s.client_reference_id } : {}),
    ...(pi ? { paymentIntentId: pi } : {}),
    ...(s.currency ? { currency: s.currency.toUpperCase() } : {}),
    ...(s.amount_total !== null ? { amountTotal: s.amount_total } : {}),
    ...(s.total_details?.amount_tax !== undefined ? { amountTax: s.total_details.amount_tax } : {}),
    consentAccepted: s.consent?.terms_of_service === 'accepted',
    customer: {
      ...(s.customer_details?.email ? { email: s.customer_details.email } : {}),
      ...(s.customer_details?.name ? { name: s.customer_details.name } : {}),
      ...(s.customer_details?.phone ? { phone: s.customer_details.phone } : {}),
    },
    ...(ship
      ? {
          shipping: {
            ...(ship.name ? { name: ship.name } : {}),
            ...(addr?.line1 ? { address1: addr.line1 } : {}),
            ...(addr?.line2 ? { address2: addr.line2 } : {}),
            ...(addr?.city ? { city: addr.city } : {}),
            ...(addr?.state ? { state: addr.state } : {}),
            ...(addr?.postal_code ? { zip: addr.postal_code } : {}),
            ...(addr?.country ? { country: addr.country } : {}),
          },
        }
      : {}),
  };
};

const toPspError = (e: unknown): PspError => {
  if (e instanceof Stripe.errors.StripeError) {
    const status = e.statusCode;
    return new PspError({
      message: `Stripe: ${e.message}`,
      retryable:
        status === undefined ||
        status === 429 ||
        status >= 500 ||
        e.type === 'StripeConnectionError',
      ...(status !== undefined ? { status } : {}),
    });
  }
  return new PspError({ message: `Stripe: ${String(e)}`, retryable: true });
};

export const makeStripe = (options: StripeOptions) =>
  Effect.gen(function* () {
    // Tests inject a fetch via FetchHttpClient.Fetch; production uses the platform's.
    const fetchFn = Option.getOrUndefined(yield* Effect.serviceOption(FetchHttpClient.Fetch));
    const stripe = new Stripe(options.secretKey, {
      httpClient: Stripe.createFetchHttpClient(fetchFn),
      maxNetworkRetries: 0,
      timeout: 15_000,
    });

    const call = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: toPspError });
    const cryptoProvider = Stripe.createSubtleCryptoProvider();

    const service: PspService = {
      health: () => call(() => stripe.balance.retrieve()).pipe(Effect.asVoid),

      getWebhookStatus: () =>
        call(() => stripe.webhookEndpoints.list({ limit: 100 })).pipe(
          Effect.map((list) => {
            const mine = list.data.find(
              (w) => /\/webhooks\/stripe$/.test(w.url) && w.status === 'enabled',
            );
            return mine
              ? { configured: true, url: mine.url }
              : {
                  configured: false,
                  detail: `no enabled endpoint ending in /webhooks/stripe (${list.data.length} endpoints)`,
                };
          }),
        ),

      createCheckoutSession: (input: CheckoutSessionInput) =>
        call(() =>
          stripe.checkout.sessions.create({
            mode: 'payment',
            client_reference_id: input.orderId,
            metadata: { pressline_order_id: input.orderId },
            payment_intent_data: { metadata: { pressline_order_id: input.orderId } },
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: input.currency.toLowerCase(),
                  unit_amount: input.product.amount,
                  tax_behavior: 'exclusive',
                  product_data: {
                    name: input.product.name,
                    ...(input.product.description
                      ? { description: input.product.description }
                      : {}),
                    ...(input.product.imageUrl ? { images: [input.product.imageUrl] } : {}),
                  },
                },
              },
            ],
            shipping_options: [
              {
                shipping_rate_data: {
                  type: 'fixed_amount',
                  display_name: input.shipping.name,
                  fixed_amount: {
                    amount: input.shipping.amount,
                    currency: input.currency.toLowerCase(),
                  },
                  tax_behavior: 'exclusive',
                  ...(input.shipping.minDeliveryDays !== undefined &&
                  input.shipping.maxDeliveryDays !== undefined
                    ? {
                        delivery_estimate: {
                          minimum: { unit: 'business_day', value: input.shipping.minDeliveryDays },
                          maximum: { unit: 'business_day', value: input.shipping.maxDeliveryDays },
                        },
                      }
                    : {}),
                },
              },
            ],
            automatic_tax: { enabled: true },
            shipping_address_collection: {
              allowed_countries: [
                input.allowedCountry as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry,
              ],
            },
            phone_number_collection: { enabled: true },
            customer_creation: 'if_required',
            consent_collection: { terms_of_service: 'required' },
            custom_text: { terms_of_service_acceptance: { message: input.consentText } },
            allow_promotion_codes: input.allowPromotionCodes,
            expires_at: input.expiresAt,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
          }),
        ).pipe(
          Effect.flatMap((session) =>
            session.url
              ? Effect.succeed({ id: session.id, url: session.url, expiresAt: session.expires_at })
              : Effect.fail(
                  new PspError({
                    message: 'Stripe returned a session without a URL',
                    retryable: false,
                  }),
                ),
          ),
        ),

      getCheckoutSession: (id) =>
        call(() => stripe.checkout.sessions.retrieve(id)).pipe(Effect.map(toSessionDetails)),

      verifyWebhook: (rawBody, signature) =>
        Effect.gen(function* () {
          if (!options.webhookSecret) {
            return yield* new WebhookRejected({
              message: 'STRIPE_WEBHOOK_SECRET is not configured',
            });
          }
          if (!signature)
            return yield* new WebhookRejected({ message: 'missing stripe-signature header' });
          const event = yield* Effect.tryPromise({
            try: () =>
              stripe.webhooks.constructEventAsync(
                rawBody,
                signature,
                options.webhookSecret!,
                options.webhookToleranceSeconds ?? 300,
                cryptoProvider,
              ),
            catch: (e) =>
              new WebhookRejected({ message: e instanceof Error ? e.message : String(e) }),
          });
          const object = event.data.object as { object?: string; id?: string };
          return {
            id: event.id,
            type: event.type,
            created: event.created,
            ...(object.object === 'checkout.session' && object.id ? { sessionId: object.id } : {}),
          };
        }),
    };
    return service;
  });

export const layerStripe = (options: StripeOptions) => Layer.effect(Psp, makeStripe(options));
