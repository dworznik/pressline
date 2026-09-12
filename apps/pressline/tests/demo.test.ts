import type { DesignResponse } from '@pressline/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDemoSafe } from '$lib/server/config/demo';
import type { DesignPage } from '$lib/server/http/api';
import type { OrderDetail } from '$lib/server/operator/read';
import type { Quote } from '$lib/server/quote/quote';
import { catalog, offers } from './fixtures/catalog';
import { png } from './fixtures/images';
import { makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness';

type Detail = typeof OrderDetail.Type;
type Page = typeof DesignPage.Type;

/**
 * Demo Mode (ticket #18) at seam 1: the whole flow runs, the provider draft
 * is canceled where it would be confirmed, and the Operator View is public
 * for reads only.
 */
const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
};
const URL_OK = 'https://engine.test/files/heron/front.png';
const boot = (demo: boolean) =>
  makeTestApp({
    config: { catalog: { offers }, demo },
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
    },
  });
const bearer = { authorization: `Bearer ${OPERATOR_TOKEN}` };

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
    paymentIntentId: 'pi_demo',
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
  await app.pspWebhook({ id: 'evt_demo', type: 'checkout.session.completed', sessionId: session });
  return body.orderId;
};

describe('Demo Mode', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('refuses to boot with a live Stripe key, and only then', () => {
    expect(() => assertDemoSafe(true, 'sk_live_abc')).toThrow(/live Stripe key/);
    expect(() => assertDemoSafe(true, 'rk_live_abc')).toThrow(/live Stripe key/);
    expect(() => assertDemoSafe(true, 'sk_test_abc')).not.toThrow();
    expect(() => assertDemoSafe(true, undefined)).not.toThrow();
    expect(() => assertDemoSafe(false, 'sk_live_abc')).not.toThrow();
  });

  it('tells the Customer about the test card on the design page', async () => {
    app = await boot(true);
    const { body } = await app.json<Page>(`/api/designs/sample/${design.id}`);
    expect(body.storefront.demo).toEqual({ testCard: '4242 4242 4242 4242' });
    await app.dispose();
    app = await boot(false);
    const live = await app.json<Page>(`/api/designs/sample/${design.id}`);
    expect(live.body.storefront.demo).toBeUndefined();
  });

  it('runs the whole flow: the draft is canceled where it would be confirmed, and the ledger says so', async () => {
    app = await boot(true);
    const id = await placeAndPay(app);
    const { body: d } = await app.json<Detail>(`/api/operator/orders/${id}`, { headers: bearer });
    expect(d.order.state).toBe('canceled');
    expect(d.transitions.map((t) => t.to)).toEqual([
      'checkout_open',
      'paid',
      'submitted',
      'canceled',
    ]);
    expect(d.transitions.at(-1)).toMatchObject({
      cause: 'stripe_webhook',
      note: 'Demo Mode: provider draft canceled instead of confirmed; nothing is produced',
    });
    expect(d.order.providerOrderId).toBeDefined();
    expect(app.providerOrders().at(-1)).toMatchObject({ externalId: id, status: 'canceled' });
    // Everything else is real: the Customer still gets the confirmation, and it says what happened.
    const mail = await app.sentMail();
    expect(mail.map((m) => m.to)).toEqual(['anna@example.com']);
    expect(mail[0]!.text).toContain('demo shop');
    expect(mail[0]!.text).not.toContain('sending it to print');
    // The thank-you and status pages read the same fact from the public Order.
    const token = new URL((await app.pspSessions()).at(-1)!.input.successUrl).searchParams.get(
      't',
    )!;
    const pub = await app.json<{ demo: boolean; state: string }>(`/api/orders/${id}?t=${token}`);
    expect(pub.body).toMatchObject({ demo: true, state: 'canceled' });
  });

  it('makes the Operator View readable without a credential, while actions still need the token', async () => {
    app = await boot(true);
    const id = await placeAndPay(app);
    expect((await app.fetch('/api/operator/health')).status).toBe(200);
    expect((await app.fetch(`/api/operator/orders/${id}`)).status).toBe(200);
    expect((await app.fetch('/api/operator/reconciliation/latest')).status).toBe(200);
    // A wrong credential is still wrong, even in Demo Mode.
    expect(
      (await app.fetch('/api/operator/health', { headers: { authorization: 'Bearer nope' } }))
        .status,
    ).toBe(401);
    for (const path of [
      '/api/operator/reconcile',
      `/api/operator/orders/${id}/cancel`,
      '/api/operator/session',
      '/api/operator/webhooks/register',
    ]) {
      const res = await app.fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status, path).toBe(401);
    }
    expect(
      (await app.fetch('/api/operator/reconcile', { method: 'POST', headers: bearer })).status,
    ).toBe(200);
    await app.dispose();
    // Outside Demo Mode reads are private as before.
    app = await boot(false);
    expect((await app.fetch('/api/operator/health')).status).toBe(401);
  });
});
