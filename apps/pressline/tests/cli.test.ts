import { FetchHttpClient } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { cli, Output } from '@pressline/cli';
import type { DesignResponse } from '@pressline/contract';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import type { Quote } from '$lib/server/quote/quote';
import { catalog, offers } from './fixtures/catalog';
import { png } from './fixtures/images';
import { makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness';

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
};
const URL_OK = 'https://engine.test/files/heron/front.png';
const URL_SMALL = 'https://engine.test/files/heron/small.jpg';
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
  });

/** Run `pressline <args>` against the app; returns the lines printed and the failure, if any. */
const run = async (app: TestApp, args: string[], token = OPERATOR_TOKEN) => {
  const lines: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    return app.fetch(u.pathname + u.search, req);
  };
  const layer = Layer.mergeAll(
    NodeContext.layer,
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
    Layer.succeed(Output, { line: (text) => Effect.sync(() => void lines.push(text)) }),
  );
  const exit = await Effect.runPromiseExit(
    cli(['node', 'pressline', '--url', 'http://pressline.test', '--token', token, ...args]).pipe(
      Effect.provide(layer),
    ),
  );
  const error = exit._tag === 'Failure' ? String(exit.cause) : undefined;
  return { lines, out: lines.join('\n'), error };
};

const placeAndPay = async (app: TestApp) => {
  const { body: q } = await app.json<Quote>(
    '/api/quote?engine=sample&designId=design-portrait-1&offer=tee-black-front&variant=black-m&country=DE',
  );
  await app.fetch(`/api/designs/sample/${design.id}/printfile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'tee-black-front', variant: 'black-m' }),
  });
  const { body } = await app.json<{ orderId: string }>('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId: q.id }),
  });
  const session = (await app.pspSessions()).at(-1)!.session.id;
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
  });
  await app.pspWebhook({ id: 'evt_cli', type: 'checkout.session.completed', sessionId: session });
  return body.orderId;
};

describe('pressline CLI', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('doctor reports the instance and fails on a bad token', async () => {
    app = await boot();
    const ok = await run(app, ['doctor']);
    expect(ok.error).toBeUndefined();
    expect(ok.out).toContain('Test Shop (EUR, 2 offers');
    expect(ok.out).toContain('✓ engine sample');
    expect(ok.out).toContain('✓ stripe webhook https://pressline.test/webhooks/stripe');
    expect(ok.out).toContain('✓ secret printful');
    expect(ok.out).toContain('✓ stripe reachable');
    expect(ok.out).toContain('✓ printful reachable');

    const bad = await run(app, ['doctor'], 'nope');
    expect(bad.error).toContain('unauthorized');
  });

  it('catalog search prints Specs, variants and an Offer snippet; check verifies every Offer', async () => {
    app = await boot();
    const search = await run(app, ['catalog', 'search', 'staple']);
    expect(search.error).toBeUndefined();
    expect(search.out).toContain('71  Unisex Staple T-Shirt | Bella + Canvas 3001');
    expect(search.out).toContain('front / dtg: 1800×2400px @ 150 dpi, png, alpha allowed');
    expect(search.out).toContain('variant 4017  Bella + Canvas 3001 (Black / M)');
    expect(search.out).toContain(
      '\'black-m\': { catalogVariantId: 4017, label: "Black / M", color: "Black", size: "M" },',
    );
    expect(search.out).toContain('catalogProductId: 71,');

    const none = await run(app, ['catalog', 'search', 'hoodie']);
    expect(none.out).toBe('No products match "hoodie".');

    const check = await run(app, ['catalog', 'check']);
    expect(check.error).toBeUndefined();
    expect(check.lines).toEqual([
      '✓ tee-black-front: 1 variants',
      '✓ poster-18x24: 1 variants',
      'All 2 Offers resolve.',
    ]);
  });

  it('catalog check names the Offer that does not resolve and exits non-zero', async () => {
    app = await makeTestApp({
      config: {
        catalog: {
          offers: [...offers, { ...offers[0]!, slug: 'tee-gone', catalogProductId: 999 }],
        },
      },
      catalog,
    });
    const check = await run(app, ['catalog', 'check']);
    expect(check.lines[2]).toMatch(/^✗ tee-gone: .*999/);
    expect(check.error).toContain('1 of 3 Offers do not resolve');
  });

  it('webhooks register creates endpoints once and verifies them after', async () => {
    app = await boot();
    const first = await run(app, ['webhooks', 'register']);
    expect(first.error).toBeUndefined();
    expect(first.lines).toEqual([
      '✓ Stripe created https://shop.example/webhooks/stripe',
      '  set STRIPE_WEBHOOK_SECRET=whsec_memory',
      '✓ Printful created https://shop.example/webhooks/printful',
      '  set PRINTFUL_WEBHOOK_SECRET=6d656d6f7279',
      '  set PRINTFUL_WEBHOOK_PUBLIC_KEY=memory-public-key',
      'Secrets are shown once: store them in the deployment now, then redeploy.',
    ]);
    const again = await run(app, ['webhooks', 'register']);
    expect(again.lines).toEqual([
      '✓ Stripe verified https://shop.example/webhooks/stripe',
      '✓ Printful verified https://shop.example/webhooks/printful',
    ]);
    const http = await run(app, ['webhooks', 'register', '--public-url', 'http://shop.example']);
    expect(http.error).toContain('https');

    // One provider down: the other is still registered and its secret shown; the command fails.
    app.pspDown(true);
    const partial = await run(app, [
      'webhooks',
      'register',
      '--public-url',
      'https://other.example',
    ]);
    expect(partial.lines).toEqual([
      '✗ Stripe https://other.example/webhooks/stripe: PSP unreachable',
      '✓ Printful created https://other.example/webhooks/printful',
      '  set PRINTFUL_WEBHOOK_SECRET=6d656d6f7279',
      '  set PRINTFUL_WEBHOOK_PUBLIC_KEY=memory-public-key',
      'Secrets are shown once: store them in the deployment now, then redeploy.',
    ]);
    expect(partial.error).toContain('1 provider(s) could not be registered');
  });

  it('orders list and show read the ledger', async () => {
    app = await boot();
    const id = await placeAndPay(app);
    const list = await run(app, ['orders', 'list', '--state', 'submitted']);
    expect(list.lines).toHaveLength(1);
    expect(list.lines[0]).toContain(id);
    expect(list.lines[0]).toContain('tee-black-front/black-m → DE  €34.79');
    expect((await run(app, ['orders', 'list', '--state', 'refunded'])).out).toBe('No orders.');

    const show = await run(app, ['orders', 'show', id]);
    expect(show.error).toBeUndefined();
    expect(show.out).toContain(`Order ${id}  submitted`);
    expect(show.out).toContain('Anna Example <anna@example.com>');
    expect(show.out).toContain('checkout_open → paid  (stripe_webhook evt_cli)');
    expect(show.out).toContain('stripe checkout.session.completed evt_cli: applied');
    expect(show.out).toMatch(/confirmation: sent/);

    const missing = await run(app, ['orders', 'show', 'nope']);
    expect(missing.error).toContain('404');
  });

  it('reconcile runs, and --dry-run changes nothing', async () => {
    app = await boot();
    const dry = await run(app, ['reconcile', '--dry-run']);
    expect(dry.error).toBeUndefined();
    expect(dry.lines[0]).toMatch(/^Reconciliation \(dry run\) took \d+ ms$/);
    expect(dry.out).toContain('  catalog: 2 checked, 0 repaired');
    expect(dry.out).toContain('No alarms.');
    const real = await run(app, ['reconcile']);
    expect(real.lines[0]).toMatch(/^Reconciliation took \d+ ms$/);
    const latest = await app.json<{ trigger: string } | null>(
      '/api/operator/reconciliation/latest',
      {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      },
    );
    expect(latest.body?.trigger).toBe('operator');
  });

  it('printfile check compares any URL with the Spec of an Offer variant', async () => {
    app = await boot();
    const good = await run(app, [
      'printfile',
      'check',
      URL_OK,
      '--offer',
      'tee-black-front',
      '--variant',
      'black-m',
    ]);
    expect(good.error).toBeUndefined();
    expect(good.out).toContain(
      'Spec tee-black-front/black-m: 1800×2400px @ 150 dpi, png, alpha allowed',
    );
    expect(good.out).toContain('File: HTTP 206, image/png, 5000 bytes, png 1800×2400');
    expect(good.out).toContain('✓ The file satisfies the Spec.');

    const wrong = await run(app, [
      'printfile',
      'check',
      URL_SMALL,
      '--offer',
      'tee-black-front',
      '--variant',
      'black-m',
    ]);
    expect(wrong.out).toContain('✗ file is 900×1200, spec requires 1800×2400');
    expect(wrong.error).toContain('1 problem(s)');

    const unknown = await run(app, [
      'printfile',
      'check',
      URL_OK,
      '--offer',
      'tee-black-front',
      '--variant',
      'xl',
    ]);
    expect(unknown.error).toContain('no Offer "tee-black-front" with variant "xl"');

    const gone = await run(app, [
      'printfile',
      'check',
      'https://engine.test/nope.png',
      '--offer',
      'tee-black-front',
      '--variant',
      'black-m',
    ]);
    expect(gone.out).toContain('File: HTTP 404');
    expect(gone.out).toContain('✗ https://engine.test/nope.png answered 404');
  });
});
