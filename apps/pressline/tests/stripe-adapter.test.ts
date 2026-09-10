import { readFileSync } from 'node:fs';
import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { Psp, PspError } from '$lib/server/services/psp';
import { layerStripe } from '$lib/server/services/stripe';

/**
 * Seam 2: the Stripe adapter against a replaying stub. The SDK's fetch is
 * injected, so the form-encoded request Stripe would receive is inspectable.
 */
const seen: { url: string; auth: string | null; body: URLSearchParams }[] = [];
let forceStatus: number | undefined;
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/stripe/${name}`, import.meta.url), 'utf8');

const stubFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  seen.push({
    url: req.url,
    auth: req.headers.get('authorization'),
    body: new URLSearchParams(await req.text()),
  });
  if (forceStatus) {
    return Response.json(
      {
        error: {
          type: forceStatus === 429 ? 'rate_limit_error' : 'invalid_request_error',
          message: 'forced',
        },
      },
      { status: forceStatus },
    );
  }
  if (new URL(req.url).pathname === '/v1/checkout/sessions') {
    return new Response(fixture('checkout-session.json'), {
      headers: { 'content-type': 'application/json' },
    });
  }
  return Response.json(
    { error: { type: 'invalid_request_error', message: 'not stubbed' } },
    { status: 404 },
  );
};

const layer = layerStripe({ secretKey: 'sk_test_stub' }).pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, stubFetch)),
);
const create = Effect.flatMap(Psp, (p) =>
  p.createCheckoutSession({
    orderId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    currency: 'EUR',
    product: {
      name: 'Black tee · Black / M',
      description: 'Blue heron',
      imageUrl: 'https://engine.test/p/heron.png',
      amount: 2500,
    },
    shipping: { name: 'Flat Rate', amount: 479, minDeliveryDays: 4, maxDeliveryDays: 7 },
    allowedCountry: 'DE',
    consentText: 'This item is made to your design.',
    successUrl: 'https://shop.test/orders/0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/thank-you?t=tok',
    cancelUrl: 'https://shop.test/order/sample/design-portrait-1?cancelled=1',
    expiresAt: 1789082600,
    allowPromotionCodes: false,
  }),
);

describe('Stripe Checkout adapter', () => {
  it('creates a payment-mode session with tax, locked country, consent and the Order ID threaded through', async () => {
    const session = await Effect.runPromise(create.pipe(Effect.provide(layer)));
    expect(session).toEqual({
      id: 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u',
      url: 'https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u',
      expiresAt: 1789082600,
    });
    const sent = seen.at(-1)!;
    expect(sent.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent.auth).toBe('Bearer sk_test_stub');
    const b = Object.fromEntries(sent.body);
    expect(b).toMatchObject({
      mode: 'payment',
      client_reference_id: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      'metadata[pressline_order_id]': '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      'payment_intent_data[metadata][pressline_order_id]': '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': '2500',
      'line_items[0][price_data][tax_behavior]': 'exclusive',
      'line_items[0][price_data][product_data][name]': 'Black tee · Black / M',
      'line_items[0][price_data][product_data][images][0]': 'https://engine.test/p/heron.png',
      'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]': '479',
      'shipping_options[0][shipping_rate_data][display_name]': 'Flat Rate',
      'shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]': '4',
      'automatic_tax[enabled]': 'true',
      'shipping_address_collection[allowed_countries][0]': 'DE',
      'phone_number_collection[enabled]': 'true',
      customer_creation: 'if_required',
      'consent_collection[terms_of_service]': 'required',
      'custom_text[terms_of_service_acceptance][message]': 'This item is made to your design.',
      allow_promotion_codes: 'false',
      expires_at: '1789082600',
      success_url: 'https://shop.test/orders/0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/thank-you?t=tok',
    });
    expect(b).not.toHaveProperty('customer');
  });

  it('maps Stripe errors: 4xx non-retryable, 429/5xx retryable', async () => {
    forceStatus = 400;
    const bad = await Effect.runPromise(create.pipe(Effect.flip, Effect.provide(layer)));
    forceStatus = 429;
    const limited = await Effect.runPromise(create.pipe(Effect.flip, Effect.provide(layer)));
    forceStatus = undefined;
    expect(bad).toBeInstanceOf(PspError);
    expect(bad).toMatchObject({ retryable: false, status: 400 });
    expect(limited).toMatchObject({ retryable: true, status: 429 });
  });
});
