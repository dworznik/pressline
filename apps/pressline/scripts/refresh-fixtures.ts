import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { FulfillmentProvider } from '../src/lib/server/services/fulfillment-provider';
import { layerPrintful } from '../src/lib/server/services/printful';
import { Psp } from '../src/lib/server/services/psp';
import { layerStripe } from '../src/lib/server/services/stripe';

/**
 * Re-record the adapter contract fixtures (ticket #25) from the live APIs by
 * driving the adapters through a recording fetch. Same file naming as the
 * replaying stubs: URL path with `/` → `_`, minus `/v2/` (Printful), or the
 * hand-picked Stripe names. Secrets are never written: the recorder keeps
 * response bodies only, and Stripe bodies get their ids masked.
 */
const out = resolve(process.argv[2] ?? 'tests/fixtures');
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const recorded = new Map<string, unknown>();
const recordingFetch =
  (name: (req: Request) => string | undefined): typeof fetch =>
  async (input, init) => {
    const req = new Request(input, init);
    const res = await fetch(req);
    const key = name(req);
    // Only successes are worth replaying; a 4xx must never replace a good fixture.
    if (key && res.ok && res.headers.get('content-type')?.includes('json')) {
      recorded.set(key, await res.clone().json());
    }
    return res;
  };

const printfulName = (req: Request) => {
  const u = new URL(req.url);
  if (u.hostname !== 'api.printful.com') return undefined;
  const key = u.pathname.replace(/^\/v2\//, '').replaceAll('/', '_');
  // The replaying stub keys by path; a method suffix only where GET and POST share one (`webhooks`).
  const shared = key === 'webhooks';
  return `printful/${key}${shared && req.method !== 'GET' ? `.${req.method.toLowerCase()}` : ''}`;
};

const printful = Effect.gen(function* () {
  const p = yield* FulfillmentProvider;
  yield* p.getCatalogProduct(71);
  yield* p.getCatalogVariant(4017);
  yield* p.getPlacementPrintAreas(71);
  yield* p.getCatalogProduct(1);
  yield* p.getCatalogVariant(1349);
  yield* p.getPlacementPrintAreas(1);
  yield* p.getVariantPrices(4017, 'EUR');
  yield* p.getShippingRates({
    countryCode: 'DE',
    items: [{ catalogVariantId: 4017, quantity: 1 }],
    currency: 'EUR',
  });
  yield* p.getWebhookStatus();
  yield* p.listCatalogVariants(71);
});

const stripeName = (req: Request) => {
  const u = new URL(req.url);
  if (!u.hostname.endsWith('stripe.com')) return undefined;
  if (u.pathname === '/v1/checkout/sessions' && req.method === 'POST')
    return 'stripe/checkout-session';
  return undefined;
};

const stripe = Effect.gen(function* () {
  const psp = yield* Psp;
  const s = yield* psp.createCheckoutSession({
    orderId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    currency: 'EUR',
    product: { name: 'Black tee, front print · Black / M', amount: 2500 },
    shipping: { name: 'Standard', amount: 479, minDeliveryDays: 3, maxDeliveryDays: 6 },
    allowedCountry: 'DE',
    consentText: 'Made to your design; no withdrawal.',
    successUrl: 'https://shop.example/orders/x/thank-you?t=y',
    cancelUrl: 'https://shop.example/order/sample/x?canceled=1',
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
    allowPromotionCodes: false,
  });
  yield* psp.expireCheckoutSession(s.id);
});

const key = env('STRIPE_SECRET_KEY');
if (!/^(sk|rk)_test_/.test(key)) throw new Error('STRIPE_SECRET_KEY must be a test-mode key');

const printfulLayer = layerPrintful({ token: env('PRINTFUL_TOKEN') }).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, recordingFetch(printfulName))),
);
const stripeLayer = layerStripe({ secretKey: key }).pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, recordingFetch(stripeName))),
);
await Effect.runPromise(
  Effect.all([
    printful.pipe(Effect.provide(printfulLayer)),
    stripe.pipe(Effect.provide(stripeLayer)),
  ]),
);

for (const [name, body] of recorded) {
  const file = resolve(out, `${name}.json`);
  mkdirSync(resolve(file, '..'), { recursive: true });
  const masked = JSON.stringify(
    body,
    (k, v) => {
      if (typeof v !== 'string') return v;
      // Session ids also travel inside Stripe's hosted-page URL; the account's webhook URL is nobody's business.
      if (/^(cs_test_|pi_|whsec_|acct_)/.test(v)) return `${v.slice(0, 8)}…`;
      if (/cs_test_[A-Za-z0-9]+/.test(v)) return v.replace(/cs_test_[A-Za-z0-9]+/g, 'cs_test_…');
      if (k === 'default_url' || (k === 'url' && v.includes('/webhooks/'))) {
        return 'https://example.invalid/webhooks/printful';
      }
      return v;
    },
    2,
  );
  writeFileSync(file, `${masked}\n`);
  console.log(`recorded ${name}`);
}
console.log(
  `refresh-fixtures: ${recorded.size} files → ${out}. Review the diff before committing.`,
);
