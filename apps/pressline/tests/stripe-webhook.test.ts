import type { DesignResponse } from '@pressline/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { listTransitions } from '$lib/server/orders/orders';
import type { PublicOrder } from '$lib/server/orders/public';
import type { Quote } from '$lib/server/quote/quote';
import { catalog, offers } from './fixtures/catalog';
import { png } from './fixtures/images';
import { makeTestApp, type TestApp } from './harness';

const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
};
const URL_OK = 'https://engine.test/files/heron/front.png';

const boot = () =>
  makeTestApp({
    config: { catalog: { offers } },
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

/** Quote → Printfile → checkout; returns the Order ID, its status token and the PSP session id. */
const placeOrder = async (app: TestApp) => {
  const { body: q } = await app.json<Quote>(
    '/api/quote?engine=sample&designId=design-portrait-1&offer=tee-black-front&variant=black-m&country=DE',
  );
  await app.fetch(`/api/designs/sample/${design.id}/printfile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'tee-black-front', variant: 'black-m' }),
  });
  const { body } = await app.json<{ orderId: string; url: string }>('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId: q.id }),
  });
  const [s] = await app.pspSessions();
  const token = new URL(s!.input.successUrl).searchParams.get('t')!;
  return { orderId: body.orderId, token, sessionId: s!.session.id, quoteId: q.id };
};

const paidSession = {
  status: 'complete' as const,
  paymentStatus: 'paid' as const,
  paymentIntentId: 'pi_3Test123',
  amountTotal: 3479,
  amountTax: 500,
  consentAccepted: true,
  customer: { email: 'anna@example.com', name: 'Anna Example', phone: '+4915112345678' },
  shipping: {
    name: 'Anna Example',
    address1: 'Torstraße 1',
    address2: 'Hinterhaus',
    city: 'Berlin',
    zip: '10119',
    country: 'DE',
  },
};

describe('POST /webhooks/stripe', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('checkout.session.completed → re-fetches the session and marks the Order paid with the Recipient and consent', async () => {
    app = await boot();
    const { orderId, token, sessionId, quoteId } = await placeOrder(app);
    app.setPspSession(sessionId, paidSession);

    const { status, body } = await app.pspWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId,
      created: 1_789_080_000,
    });
    expect(status).toBe(200);
    expect(body.outcome).toMatch(/^applied:submit=/);

    const order = await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`);
    expect(order.body).toMatchObject({
      state: 'submitted',
      amountTotal: 3479,
      recipient: { firstName: 'Anna', city: 'Berlin', country: 'DE' }, // masked: no street, no email
    });

    const transitions = await app.run(listTransitions(orderId));
    expect(transitions._tag).toBe('Success');
    if (transitions._tag === 'Success') {
      expect(transitions.value.map((t) => [t.from, t.to, t.cause, t.causeRef])).toEqual([
        [null, 'checkout_open', 'storefront', quoteId],
        ['checkout_open', 'paid', 'stripe_webhook', 'evt_1'],
        ['paid', 'submitted', 'stripe_webhook', 'evt_1'],
      ]);
    }
  });

  it('acknowledges a duplicate delivery without a second Transition', async () => {
    app = await boot();
    const { orderId, sessionId } = await placeOrder(app);
    app.setPspSession(sessionId, paidSession);
    await app.pspWebhook({ id: 'evt_1', type: 'checkout.session.completed', sessionId });
    const again = await app.pspWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toMatch(/^duplicate/);
    const transitions = await app.run(listTransitions(orderId));
    expect(transitions._tag === 'Success' && transitions.value).toHaveLength(3); // open, paid, submitted
  });

  it('refuses a forbidden move: expired arriving after paid changes nothing', async () => {
    app = await boot();
    const { orderId, token, sessionId } = await placeOrder(app);
    app.setPspSession(sessionId, paidSession);
    await app.pspWebhook({ id: 'evt_1', type: 'checkout.session.completed', sessionId });
    app.setPspSession(sessionId, { status: 'expired' });
    app.setPspSession(sessionId, { status: 'expired' });
    const late = await app.pspWebhook({ id: 'evt_2', type: 'checkout.session.expired', sessionId });
    expect(late.status).toBe(200);
    expect(late.body.outcome).toMatch(/^refused:submitted->expired/);
    const order = await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`);
    expect(order.body.state).toBe('submitted');
  });

  it('checkout.session.expired moves an open Order to expired', async () => {
    app = await boot();
    const { orderId, token, sessionId } = await placeOrder(app);
    app.setPspSession(sessionId, { status: 'expired' });
    const { body } = await app.pspWebhook({
      id: 'evt_x',
      type: 'checkout.session.expired',
      sessionId,
    });
    expect(body.outcome).toMatch(/^applied/);
    const order = await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`);
    expect(order.body.state).toBe('expired');
  });

  it('never acts on the delivery body: a "completed" event for a session Stripe says is unpaid is ignored', async () => {
    app = await boot();
    const { orderId, token, sessionId } = await placeOrder(app);
    const { body } = await app.pspWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(body.outcome).toMatch(/^ignored:payment_status=unpaid/);
    const order = await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`);
    expect(order.body.state).toBe('checkout_open');
  });

  it('rejects a bad or missing signature with 400 and records nothing', async () => {
    app = await boot();
    const { sessionId } = await placeOrder(app);
    expect(
      (
        await app.pspWebhook(
          { id: 'evt_1', type: 'checkout.session.completed', sessionId },
          'memory:forged',
        )
      ).status,
    ).toBe(400);
    expect((await app.fetch('/webhooks/stripe', { method: 'POST', body: '{}' })).status).toBe(400);
    // The forged delivery was not recorded, so the genuine one is not a duplicate.
    app.setPspSession(sessionId, paidSession);
    const real = await app.pspWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(real.body.outcome).toMatch(/^applied/);
  });

  it('records unknown_order for a session Stripe knows but the ledger does not, and ignores other event types', async () => {
    app = await boot();
    app.setPspSession('cs_unknown', { ...paidSession, id: 'cs_unknown' });
    const unknown = await app.pspWebhook({
      id: 'evt_u',
      type: 'checkout.session.completed',
      sessionId: 'cs_unknown',
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.outcome).toBe('unknown_order:cs_unknown');
    // A session Stripe itself has never heard of is not retryable either.
    const gone = await app.pspWebhook({
      id: 'evt_g',
      type: 'checkout.session.completed',
      sessionId: 'cs_nope',
    });
    expect(gone.status).toBe(200);
    expect(gone.body.outcome).toMatch(/^failed:/);
    expect(
      (await app.pspWebhook({ id: 'evt_o', type: 'payment_intent.created' })).body.outcome,
    ).toMatch(/^ignored/);
  });

  it('treats a fully discounted session (no_payment_required) as paid', async () => {
    app = await boot();
    const { orderId, token, sessionId } = await placeOrder(app);
    app.setPspSession(sessionId, { ...paidSession, paymentStatus: 'no_payment_required' });
    await app.pspWebhook({ id: 'evt_free', type: 'checkout.session.completed', sessionId });
    expect((await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)).body.state).not.toBe(
      'checkout_open',
    );
  });

  it('marks paid but notes a missing Recipient so the Operator can act', async () => {
    app = await boot();
    const { sessionId } = await placeOrder(app);
    const { shipping: _shipping, ...noShipping } = paidSession;
    app.setPspSession(sessionId, noShipping);
    const { body } = await app.pspWebhook({
      id: 'evt_nr',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(body.outcome).toMatch(/no_recipient/);
    expect(body.outcome).toMatch(/submit=submit_failed/);
  });

  it('answers 500 (so Stripe retries) when the session cannot be re-fetched, and processes the retry', async () => {
    app = await boot();
    const { orderId, token, sessionId } = await placeOrder(app);
    app.setPspSession(sessionId, paidSession);
    app.pspDown(true);
    expect(
      (await app.pspWebhook({ id: 'evt_1', type: 'checkout.session.completed', sessionId })).status,
    ).toBe(500);
    app.pspDown(false);
    const retry = await app.pspWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(retry.body.outcome).toMatch(/^applied/);
    expect((await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)).body.state).toBe(
      'submitted',
    );
  });
});
