import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import Stripe from 'stripe';
import { Psp, PspError, type CheckoutSessionInput, type PspService } from './psp';

/**
 * Stripe Checkout adapter (ADR-0010). Hosted page, payment mode, automatic
 * tax, guest checkout, shipping country locked to the Quote's, consent to the
 * Withdrawal Notice collected by Stripe. Uses the official SDK over `fetch`
 * (so it runs on Workers) with WebCrypto for webhook signatures.
 */
export interface StripeOptions {
  readonly secretKey: string;
}

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

    const service: PspService = {
      health: () => call(() => stripe.balance.retrieve()).pipe(Effect.asVoid),

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
    };
    return service;
  });

export const layerStripe = (options: StripeOptions) => Layer.effect(Psp, makeStripe(options));
