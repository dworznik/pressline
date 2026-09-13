import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FetchHttpClient } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { cli, Output } from '@pressline/cli'
import type { DesignResponse } from '@pressline/contract'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Quote } from '$lib/server/quote/quote'
import { catalog, offers } from './fixtures/catalog'
import { png } from './fixtures/images'
import { makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness'

/**
 * The CLI at seam 1: argv in, operator API over the in-process handler,
 * lines out. What the Operator sees, not how the client is built.
 */
const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
}
const URL_OK = 'https://engine.test/files/heron/front.png'
const URL_SMALL = 'https://engine.test/files/heron/small.jpg'
const boot = () =>
  makeTestApp({
    config: { catalog: { offers }, checkout: { publicUrl: 'https://shop.example' } },
    catalog,
    engines: {
      engines: {
        sample: {
          designs: { [design.id]: design },
          printfiles: { [design.id]: { kind: 'ready', url: URL_OK, bytes: 5000 } },
        },
      },
    },
    files: {
      [URL_OK]: {
        bytes: png({ width: 1800, height: 2400, totalBytes: 5000 }),
        contentType: 'image/png',
      },
      [URL_SMALL]: {
        bytes: png({ width: 900, height: 1200, totalBytes: 3000 }),
        contentType: 'image/png',
      },
    },
  })

/** Run `pressline <args>` against the app; returns the lines printed and the failure, if any. `token: null` omits `--token`. */
const run = async (
  app: TestApp,
  args: string[],
  token: string | null = OPERATOR_TOKEN,
  withUrl = true,
) => {
  const lines: string[] = []
  const fetch: typeof globalThis.fetch = (input, init) => {
    const req = new Request(input, init)
    const u = new URL(req.url)
    return app.fetch(u.pathname + u.search, req)
  }
  const layer = Layer.mergeAll(
    NodeContext.layer,
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
    Layer.succeed(Output, { line: (text) => Effect.sync(() => void lines.push(text)) }),
  )
  const exit = await Effect.runPromiseExit(
    cli([
      'node',
      'pressline',
      ...(withUrl ? ['--url', 'http://pressline.test'] : []),
      ...(token === null ? [] : ['--token', token]),
      ...args,
    ]).pipe(Effect.provide(layer)),
  )
  const error = exit._tag === 'Failure' ? String(exit.cause) : undefined
  return { lines, out: lines.join('\n'), error }
}

const placeAndPay = async (app: TestApp) => {
  const { body: q } = await app.json<Quote>(
    '/api/quote?engine=sample&designId=design-portrait-1&offer=tee-black-front&variant=black-m&country=DE',
  )
  await app.fetch(`/api/designs/sample/${design.id}/printfile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'tee-black-front', variant: 'black-m' }),
  })
  const { body } = await app.json<{ orderId: string }>('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId: q.id }),
  })
  const session = (await app.pspSessions()).at(-1)!.session.id
  app.setPspSession(session, {
    status: 'complete',
    paymentStatus: 'paid',
    paymentIntentId: 'pi_cli',
    amountTotal: 3479,
    amountTax: 500,
    consentAccepted: true,
    customer: { email: 'anna@example.com', name: 'Anna Example' },
    shipping: {
      name: 'Anna Example',
      address1: 'Torstraße 1',
      city: 'Berlin',
      zip: '10119',
      country: 'DE',
    },
  })
  await app.pspWebhook({ id: 'evt_cli', type: 'checkout.session.completed', sessionId: session })
  return body.orderId
}

describe('pressline CLI', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('doctor reports the instance and fails on a bad token', async () => {
    app = await boot()
    const ok = await run(app, ['doctor'])
    expect(ok.error).toBeUndefined()
    expect(ok.out).toContain('Test Shop (EUR, 2 offers')
    expect(ok.out).toContain('✓ engine sample')
    expect(ok.out).toContain('✓ stripe webhook https://pressline.test/webhooks/stripe')
    expect(ok.out).toContain('✓ secret printful')
    expect(ok.out).toContain('✓ stripe reachable')
    expect(ok.out).toContain('✓ printful reachable')

    const bad = await run(app, ['doctor'], 'nope')
    expect(bad.error).toContain('unauthorized')
  })

  it('catalog search prints Specs, variants and an Offer snippet; check verifies every Offer', async () => {
    app = await boot()
    const search = await run(app, ['catalog', 'search', 'staple'])
    expect(search.error).toBeUndefined()
    expect(search.out).toContain('71  Unisex Staple T-Shirt | Bella + Canvas 3001')
    expect(search.out).toContain('front / dtg: 1800×2400px @ 150 dpi, png, alpha allowed')
    expect(search.out).toContain('variant 4017  Bella + Canvas 3001 (Black / M)')
    expect(search.out).toContain(
      '\'black-m\': { catalogVariantId: 4017, label: "Black / M", color: "Black", size: "M" },',
    )
    expect(search.out).toContain('catalogProductId: 71,')

    const none = await run(app, ['catalog', 'search', 'hoodie'])
    expect(none.out).toBe('No products match "hoodie".')

    const check = await run(app, ['catalog', 'check'])
    expect(check.error).toBeUndefined()
    expect(check.lines).toEqual([
      '✓ tee-black-front: 1 variants',
      '✓ poster-18x24: 1 variants',
      'All 2 Offers resolve.',
    ])
  })

  it('catalog check names the Offer that does not resolve and exits non-zero', async () => {
    app = await makeTestApp({
      config: {
        catalog: {
          offers: [...offers, { ...offers[0]!, slug: 'tee-gone', catalogProductId: 999 }],
        },
      },
      catalog,
    })
    const check = await run(app, ['catalog', 'check'])
    expect(check.lines[2]).toMatch(/^✗ tee-gone: .*999/)
    expect(check.error).toContain('1 of 3 Offers do not resolve')
  })

  it('webhooks register creates endpoints once and verifies them after', async () => {
    app = await boot()
    const first = await run(app, ['webhooks', 'register'])
    expect(first.error).toBeUndefined()
    expect(first.lines).toEqual([
      '✓ Stripe created https://shop.example/webhooks/stripe',
      '  set STRIPE_WEBHOOK_SECRET=whsec_memory',
      '✓ Printful created https://shop.example/webhooks/printful',
      '  set PRINTFUL_WEBHOOK_SECRET=6d656d6f7279',
      '  set PRINTFUL_WEBHOOK_PUBLIC_KEY=memory-public-key',
      'Secrets are shown once: store them in the deployment now, then redeploy.',
    ])
    const again = await run(app, ['webhooks', 'register'])
    expect(again.lines).toEqual([
      '✓ Stripe verified https://shop.example/webhooks/stripe',
      '✓ Printful verified https://shop.example/webhooks/printful',
    ])
    const http = await run(app, ['webhooks', 'register', '--public-url', 'http://shop.example'])
    expect(http.error).toContain('https')

    // One provider down: the other is still registered and its secret shown; the command fails.
    app.pspDown(true)
    const partial = await run(app, [
      'webhooks',
      'register',
      '--public-url',
      'https://other.example',
    ])
    expect(partial.lines).toEqual([
      '✗ Stripe https://other.example/webhooks/stripe: PSP unreachable',
      '✓ Printful created https://other.example/webhooks/printful',
      '  set PRINTFUL_WEBHOOK_SECRET=6d656d6f7279',
      '  set PRINTFUL_WEBHOOK_PUBLIC_KEY=memory-public-key',
      'Secrets are shown once: store them in the deployment now, then redeploy.',
    ])
    expect(partial.error).toContain('1 provider(s) could not be registered')
  })

  it('orders list and show read the ledger', async () => {
    app = await boot()
    const id = await placeAndPay(app)
    const list = await run(app, ['orders', 'list', '--state', 'submitted'])
    expect(list.lines).toHaveLength(1)
    expect(list.lines[0]).toContain(id)
    expect(list.lines[0]).toContain('tee-black-front/black-m → DE  €34.79')
    expect((await run(app, ['orders', 'list', '--state', 'refunded'])).out).toBe('No orders.')

    const show = await run(app, ['orders', 'show', id])
    expect(show.error).toBeUndefined()
    expect(show.out).toContain(`Order ${id}  submitted`)
    expect(show.out).toContain('Anna Example <anna@example.com>')
    expect(show.out).toContain('checkout_open → paid  (stripe_webhook evt_cli)')
    expect(show.out).toContain('stripe checkout.session.completed evt_cli: applied')
    expect(show.out).toMatch(/confirmation: sent/)

    const missing = await run(app, ['orders', 'show', 'nope'])
    expect(missing.error).toContain('404')
  })

  it('reconcile runs, and --dry-run changes nothing', async () => {
    app = await boot()
    const dry = await run(app, ['reconcile', '--dry-run'])
    expect(dry.error).toBeUndefined()
    expect(dry.lines[0]).toMatch(/^Reconciliation \(dry run\) took \d+ ms$/)
    expect(dry.out).toContain('  catalog: 2 checked, 0 repaired')
    expect(dry.out).toContain('No alarms.')
    const real = await run(app, ['reconcile'])
    expect(real.lines[0]).toMatch(/^Reconciliation took \d+ ms$/)
    const latest = await app.json<{ trigger: string } | null>(
      '/api/operator/reconciliation/latest',
      {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      },
    )
    expect(latest.body?.trigger).toBe('operator')
  })

  it('printfile check compares any URL with the Spec of an Offer variant', async () => {
    app = await boot()
    const good = await run(app, [
      'printfile',
      'check',
      URL_OK,
      '--offer',
      'tee-black-front',
      '--variant',
      'black-m',
    ])
    expect(good.error).toBeUndefined()
    expect(good.out).toContain(
      'Spec tee-black-front/black-m: 1800×2400px @ 150 dpi, png, alpha allowed',
    )
    expect(good.out).toContain('File: HTTP 206, image/png, 5000 bytes, png 1800×2400')
    expect(good.out).toContain('✓ The file satisfies the Spec.')

    const wrong = await run(app, [
      'printfile',
      'check',
      URL_SMALL,
      '--offer',
      'tee-black-front',
      '--variant',
      'black-m',
    ])
    expect(wrong.out).toContain('✗ file is 900×1200, spec requires 1800×2400')
    expect(wrong.error).toContain('1 problem(s)')

    const unknown = await run(app, [
      'printfile',
      'check',
      URL_OK,
      '--offer',
      'tee-black-front',
      '--variant',
      'xl',
    ])
    expect(unknown.error).toContain('no Offer "tee-black-front" with variant "xl"')

    const gone = await run(app, [
      'printfile',
      'check',
      'https://engine.test/nope.png',
      '--offer',
      'tee-black-front',
      '--variant',
      'black-m',
    ])
    expect(gone.out).toContain('File: HTTP 404')
    expect(gone.out).toContain('✗ https://engine.test/nope.png answered 404')
  })

  it('offers lists every Offer with its distinct Specs, without a token', async () => {
    app = await boot()
    const r = await run(app, ['offers'], null)
    expect(r.error).toBeUndefined()
    expect(r.lines[0]).toBe('tee-black-front  Black tee, front print — front / dtg, €25.00')
    expect(r.lines[1]).toMatch(
      /^ {2}1800×2400px @ 150 dpi, png, alpha allowed \(hash [0-9a-f]{12}…\) {2}black-m$/,
    )
    expect(r.lines[2]).toBe(
      'poster-18x24  Matte poster 18×24 — default / digital, aspect 0.7–0.8, €19.00',
    )
    expect(r.lines[3]).toMatch(/^ {2}2700×3600px @ 150 dpi, png\/jpeg, alpha forbidden \(hash /)
    expect(r.lines[3]).toMatch(/ {2}18x24$/)
  })

  it('offers --json groups variants by Spec Hash so a group can be piped into preflight', async () => {
    app = await boot()
    const r = await run(app, ['offers', '--json'], null)
    expect(r.error).toBeUndefined()
    const json = JSON.parse(r.out) as {
      currency: string
      offers: Array<{
        slug: string
        specs: Array<{
          specHash: string
          spec: { width: number }
          variants: Array<{ key: string }>
        }>
      }>
    }
    expect(json.currency).toBe('EUR')
    expect(json.offers.map((o) => o.slug)).toEqual(['tee-black-front', 'poster-18x24'])
    const tee = json.offers[0]!.specs
    expect(tee).toHaveLength(1)
    expect(tee[0]!.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tee[0]!.spec.width).toBe(1800)
    expect(tee[0]!.variants.map((v) => v.key)).toEqual(['black-m'])
  })

  it('offers groups the variants of one Offer that share a Spec, and separates those that do not', async () => {
    // A second tee size with the same print area shares the Spec; a back print does not.
    app = await makeTestApp({
      config: {
        catalog: {
          offers: [
            {
              ...offers[0]!,
              variants: {
                'black-m': { catalogVariantId: 4017, label: 'Black / M' },
                'black-l': { catalogVariantId: 4018, label: 'Black / L' },
              },
            },
            {
              ...offers[0]!,
              slug: 'tee-black-back',
              name: 'Black tee, back print',
              placement: 'back',
            },
          ],
        },
      },
      catalog: {
        ...catalog,
        variants: [
          ...catalog.variants,
          { ...catalog.variants[0]!, id: 4018, name: 'Bella + Canvas 3001 (Black / L)', size: 'L' },
        ],
        prices: { ...catalog.prices, 4018: catalog.prices![4017]! },
        printAreas: {
          ...catalog.printAreas,
          71: [
            ...catalog.printAreas[71]!,
            {
              placement: 'back',
              technique: 'dtg',
              printAreaWidthIn: 12,
              printAreaHeightIn: 14,
              dpi: 150,
            },
          ],
        },
      },
    })
    const r = await run(app, ['offers', '--json'], null)
    expect(r.error).toBeUndefined()
    const json = JSON.parse(r.out) as {
      offers: Array<{
        slug: string
        specs: Array<{ specHash: string; variants: Array<{ key: string }> }>
      }>
    }
    const [front, back] = json.offers
    expect(front!.specs).toHaveLength(1)
    expect(front!.specs[0]!.variants.map((v) => v.key)).toEqual(['black-m', 'black-l'])
    expect(back!.specs[0]!.specHash).not.toBe(front!.specs[0]!.specHash)

    const text = await run(app, ['offers'], null)
    expect(text.lines[1]).toMatch(/ {2}black-m, black-l$/)
  })

  it('a command that needs the operator API says so when no token is given', async () => {
    app = await boot()
    const r = await run(app, ['doctor'], null)
    expect(r.error).toContain('operator token')
  })

  it('engine conformance runs the suite against an Engine base URL and fails when it is not conformant', async () => {
    app = await boot()
    // The test fetch routes every host to the bridge, which is no Engine: the health check fails.
    const r = await run(
      app,
      ['engine', 'conformance', 'https://engine.test', '--secret', 's', '--design', 'd'],
      null,
    )
    expect(r.out).toContain('✗ health')
    expect(r.error).toContain('not conformant')
  })

  it('engine preflight takes the Spec of one Offer variant from the instance', async () => {
    app = await boot()
    const dir = await mkdtemp(join(tmpdir(), 'pressline-preflight-'))
    const file = join(dir, 'front.png')
    await writeFile(file, png({ width: 1800, height: 2400 }))
    const r = await run(
      app,
      ['engine', 'preflight', file, '--offer', 'tee-black-front', '--variant', 'black-m'],
      null,
    )
    expect(r.lines[0]).toMatch(
      /^Spec tee-black-front\/black-m: 1800×2400px @ 150 dpi, png, alpha allowed \(hash [0-9a-f]{12}…\)$/,
    )
    // The header is all the file has: no sRGB chunk and no pHYs, which are Deviations, not refusals.
    expect(r.out).toContain('✓ nothing Validation would refuse')
    expect(r.out).toContain('⚠ dpi_missing:')
    expect(r.error).toBeUndefined()

    const wrong = await run(app, ['engine', 'preflight', file, '--offer', 'no-such-offer'], null)
    expect(wrong.error).toContain('sells no Offer "no-such-offer"')
  })

  it('engine preflight without --variant checks every distinct Spec of the Offer', async () => {
    // A larger size with a larger print area: one Offer, two Printfile Specs.
    app = await makeTestApp({
      config: {
        catalog: {
          offers: [
            {
              ...offers[0]!,
              variants: {
                'black-m': { catalogVariantId: 4017, label: 'Black / M' },
                'black-l': { catalogVariantId: 4018, label: 'Black / L' },
              },
            },
          ],
        },
      },
      catalog: {
        ...catalog,
        variants: [
          ...catalog.variants,
          {
            ...catalog.variants[0]!,
            id: 4018,
            name: 'Bella + Canvas 3001 (Black / L)',
            size: 'L',
            placementDimensions: [
              { placement: 'front', widthIn: 13, heightIn: 17, orientation: 'any' },
            ],
          },
        ],
        prices: { ...catalog.prices, 4018: catalog.prices![4017]! },
      },
    })
    const dir = await mkdtemp(join(tmpdir(), 'pressline-preflight-'))
    const file = join(dir, 'front.png')
    await writeFile(file, png({ width: 1800, height: 2400 }))
    const r = await run(app, ['engine', 'preflight', file, '--offer', 'tee-black-front'], null)
    expect(r.lines.filter((l) => l.startsWith('Spec'))).toHaveLength(2)
    expect(r.out).toContain('Spec tee-black-front/black-m: 1800×2400px')
    expect(r.out).toContain('Spec tee-black-front/black-l: 1950×2550px')
    expect(r.out).toContain('✗ dimensions: file is 1800×2400, spec requires 1950×2550')
    expect(r.lines.at(-1)).toBe('1 file × 2 Specs: 1 refused, 1 with Deviations, 0 clean.')
    expect(r.error).toContain('1 of 2 would be refused before payment')
  })

  it('engine conformance needs no --url, and offers says so when it is missing', async () => {
    app = await boot()
    const r = await run(
      app,
      ['engine', 'conformance', 'https://engine.test', '--secret', 's', '--design', 'd'],
      null,
      false,
    )
    expect(r.out).toContain('✗ health')
    const missing = await run(app, ['offers'], null, false)
    expect(missing.error).toContain('instance URL')
  })
})
