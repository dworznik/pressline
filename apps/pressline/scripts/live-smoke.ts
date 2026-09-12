import { FetchHttpClient } from '@effect/platform'
import { Effect, Layer } from 'effect'
import { FulfillmentProvider } from '../src/lib/server/services/fulfillment-provider'
import { layerPrintful } from '../src/lib/server/services/printful'
import { Psp } from '../src/lib/server/services/psp'
import { layerStripe } from '../src/lib/server/services/stripe'

/**
 * Nightly live smoke (ticket #25): the real adapters against Printful and
 * Stripe test mode, spending nothing and confirming nothing. Fails loudly
 * when either API changes shape under the adapters. Needs PRINTFUL_TOKEN
 * and STRIPE_SECRET_KEY (a test-mode key); refuses a live Stripe key.
 */
const PRINTFILE_URL =
  process.env['SMOKE_PRINTFILE_URL'] ||
  'https://raw.githubusercontent.com/dworznik/pressline/main/apps/docs/public/smoke-1800x2400.png'
const VARIANT = Number(process.env['SMOKE_CATALOG_VARIANT_ID'] ?? 4017) // Bella+Canvas 3001, Black / M
const PRODUCT = Number(process.env['SMOKE_CATALOG_PRODUCT_ID'] ?? 71)

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set`)
  return v
}

const printful = Effect.gen(function* () {
  const p = yield* FulfillmentProvider
  yield* p.health()
  const product = yield* p.getCatalogProduct(PRODUCT)
  const variant = yield* p.getCatalogVariant(VARIANT)
  const areas = yield* p.getPlacementPrintAreas(PRODUCT)
  const rates = yield* p.getShippingRates({
    countryCode: 'DE',
    items: [{ catalogVariantId: VARIANT, quantity: 1 }],
    currency: 'EUR',
  })
  const prices = yield* p.getVariantPrices(VARIANT, 'EUR')
  console.log(
    `printful: ${product.name} / ${variant.name}; ${areas.length} print areas; ${rates.length} rates to DE; ${Object.keys(prices.byTechnique).length} techniques`,
  )
  if (rates.length === 0) throw new Error('no shipping rates to DE')

  // A draft with the fixture Printfile: created, costed, deleted. Never confirmed.
  const externalId = `smoke-${Date.now()}`
  const draft = yield* p.createOrderDraft({
    externalId,
    shippingMethod: rates[0]!.method,
    recipient: {
      name: 'Pressline Smoke',
      address1: 'Torstraße 1',
      city: 'Berlin',
      countryCode: 'DE',
      zip: '10119',
      email: 'smoke@example.com',
    },
    item: {
      catalogVariantId: VARIANT,
      placement: 'front',
      technique: 'dtg',
      printfileUrl: PRINTFILE_URL,
      retailPrice: '25.00',
    },
    currency: 'EUR',
  })
  console.log(`printful: draft ${draft.id} status ${draft.status}`)
  const check = Effect.gen(function* () {
    if (draft.status !== 'draft') throw new Error(`draft has status ${draft.status}`)
    // Costs are calculated asynchronously; give Printful a moment.
    let costed = draft
    for (let i = 0; i < 10 && (!costed.costs || costed.costs.calculating); i++) {
      yield* Effect.sleep('2 seconds')
      costed = yield* p.getOrder(draft.id)
    }
    if (!costed.costs || costed.costs.calculating) throw new Error('draft costs never calculated')
    if (costed.costs.subtotal <= 0) {
      throw new Error(
        `draft costs came back empty (${JSON.stringify(costed.costs)}): calculation failed or the Printfile URL is not fetchable`,
      )
    }
    console.log(
      `printful: costs ${costed.costs.subtotal} + ${costed.costs.shipping} ${costed.costs.currency}`,
    )
    const found = yield* p.findOrderByExternalId(externalId)
    if (found?.id !== draft.id) throw new Error('lookup by external id did not find the draft')
  })
  // Whatever happens above, the draft is deleted: nothing is left in the store.
  yield* check.pipe(
    Effect.ensuring(
      p.cancelOrder(draft.id).pipe(
        Effect.tap((r) => Effect.sync(() => console.log(`printful: draft ${draft.id} ${r}`))),
        Effect.orDie,
      ),
    ),
  )
})

const stripe = Effect.gen(function* () {
  const psp = yield* Psp
  yield* psp.health()
  const session = yield* psp.createCheckoutSession({
    orderId: `smoke-${Date.now()}`,
    currency: 'EUR',
    product: { name: 'Smoke tee', amount: 2500 },
    shipping: { name: 'Standard', amount: 479 },
    allowedCountry: 'DE',
    consentText: 'Made to your design; no withdrawal.',
    successUrl: 'https://example.com/ok',
    cancelUrl: 'https://example.com/cancel',
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
    allowPromotionCodes: false,
  })
  const details = yield* psp.getCheckoutSession(session.id)
  console.log(
    `stripe: session ${session.id} ${details.status}/${details.paymentStatus}, total ${details.amountTotal}`,
  )
  if (details.paymentStatus !== 'unpaid' || details.amountTotal !== 2979)
    throw new Error('session shape changed')
  yield* psp.expireCheckoutSession(session.id)
  const after = yield* psp.getCheckoutSession(session.id)
  if (after.status !== 'expired') throw new Error(`session status after expire: ${after.status}`)
  const webhooks = yield* psp.getWebhookStatus()
  console.log(
    `stripe: session expired; webhook endpoint ${webhooks.configured ? webhooks.url : 'not registered (fine for smoke)'}`,
  )
})

const key = env('STRIPE_SECRET_KEY')
if (!/^(sk|rk)_test_/.test(key)) throw new Error('STRIPE_SECRET_KEY must be a test-mode key')

await Effect.runPromise(
  Effect.all([printful, stripe], { concurrency: 2 }).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerPrintful({ token: env('PRINTFUL_TOKEN') }),
        layerStripe({ secretKey: key }),
      ).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  ),
)
console.log('live smoke: ok')
