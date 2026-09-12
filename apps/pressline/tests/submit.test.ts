import type { DesignResponse } from '@pressline/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { listTransitions } from '$lib/server/orders/orders';
import type { PublicOrder } from '$lib/server/orders/public';
import type { Quote } from '$lib/server/quote/quote';
import type { MemoryCatalog } from '$lib/server/services/memory';
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

const boot = (orders: MemoryCatalog['orders'] = {}) =>
  makeTestApp({
    config: { catalog: { offers } },
    catalog: { ...catalog, orders },
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
    city: 'Berlin',
    zip: '10119',
    country: 'DE',
  },
};

/** Quote → Printfile → checkout → Stripe says paid; returns ids and the ack outcome. */
const payFor = async (app: TestApp, eventId = 'evt_1') => {
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
  const [s] = await app.pspSessions();
  const token = new URL(s!.input.successUrl).searchParams.get('t')!;
  app.setPspSession(s!.session.id, paidSession);
  const ack = await app.pspWebhook({
    id: eventId,
    type: 'checkout.session.completed',
    sessionId: s!.session.id,
  });
  return { orderId: body.orderId, token, sessionId: s!.session.id, ack };
};

const stateOf = async (app: TestApp, orderId: string, token: string) =>
  (await app.json<PublicOrder>(`/api/orders/${orderId}?t=${token}`)).body.state;

describe('paid → submitted (Printful draft → check → confirm)', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('creates a draft with external_id = Order ID, confirms it, and records the provider order id', async () => {
    app = await boot();
    const { orderId, token, ack } = await payFor(app);
    expect(ack.body.outcome).toMatch(/^applied:submit=submitted/);
    expect(await stateOf(app, orderId, token)).toBe('submitted');
    const [po] = app.providerOrders();
    expect(po).toMatchObject({
      externalId: orderId,
      status: 'pending',
      recipient: { countryCode: 'DE' },
    });
    expect(po!.items[0]).toMatchObject({ catalogVariantId: 4017 });
    const t = await app.run(listTransitions(orderId));
    expect(t._tag === 'Success' && t.value.map((x) => [x.to, x.cause, x.causeRef])).toEqual([
      ['checkout_open', 'storefront', expect.any(String)],
      ['paid', 'stripe_webhook', 'evt_1'],
      ['submitted', 'stripe_webhook', 'evt_1'],
    ]);
  });

  it('waits for the provider to finish pricing the draft before confirming it', async () => {
    app = await boot({ costsCalculatingReads: 2 }); // create + first re-read say "calculating"
    const { orderId, token, ack } = await payFor(app);
    expect(ack.status).toBe(200);
    expect(ack.body.outcome).toMatch(/^applied:submit=submitted/);
    expect(await stateOf(app, orderId, token)).toBe('submitted');
    expect(app.providerOrders()).toHaveLength(1);
    expect(app.providerOrders()[0]!.status).toBe('pending');
  });

  it('gives up on a draft still pricing after the polling window: retry_later, the Order stays paid', async () => {
    app = await boot({ costsCalculatingReads: 100 });
    const { orderId, token, ack } = await payFor(app);
    expect(ack.status).toBe(200);
    expect(ack.body.outcome).toMatch(/^applied:submit=retry_later/);
    expect(await stateOf(app, orderId, token)).toBe('paid');
    expect(app.providerOrders()).toHaveLength(1);
    expect(app.providerOrders()[0]!.status).toBe('draft'); // never confirmed while calculating
  }, 20_000);

  it('re-run after a confirm failure reuses the existing draft: no second draft, then confirmed', async () => {
    app = await boot({ confirmRetryableFailures: 5 }); // more than one handler's retries (1 + 3), fewer than two
    const { orderId, token, sessionId, ack } = await payFor(app);
    expect(ack.status).toBe(200);
    expect(ack.body.outcome).toMatch(/^applied:submit=retry_later/);
    expect(await stateOf(app, orderId, token)).toBe('paid');
    expect(app.providerOrders()).toHaveLength(1);
    expect(app.providerOrders()[0]!.status).toBe('draft');

    // Stripe redelivers (or Reconciliation runs): the provider is fine now.
    app.setProviderOrderStatus(app.providerOrders()[0]!.id, 'draft');
    const again = await app.pspWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(again.body.outcome).toMatch(/^duplicate/); // same event id is not reprocessed …
    const redelivered = await app.pspWebhook({
      id: 'evt_2',
      type: 'checkout.session.completed',
      sessionId,
    });
    expect(redelivered.body.outcome).toMatch(/^applied:already,submit=submitted/); // … but a new delivery retries the submit
    expect(await stateOf(app, orderId, token)).toBe('submitted');
    expect(app.providerOrders()).toHaveLength(1);
  });

  it('retries transient failures within the handler and still submits', async () => {
    app = await boot({ createRetryableFailures: 2 });
    const { orderId, token, ack } = await payFor(app);
    expect(ack.body.outcome).toMatch(/^applied:submit=submitted/);
    expect(await stateOf(app, orderId, token)).toBe('submitted');
  });

  it('a destination mismatch between draft and Order blocks confirmation → submit_failed', async () => {
    app = await boot({ draftCountryOverride: 'FR' });
    const { orderId, token, ack } = await payFor(app);
    expect(ack.body.outcome).toMatch(/^applied:submit=submit_failed/);
    expect(await stateOf(app, orderId, token)).toBe('submit_failed');
    expect(app.providerOrders()[0]!.status).toBe('draft'); // never confirmed
  });

  it('a variant mismatch between draft and Order blocks confirmation → submit_failed, with the reason on the Transition', async () => {
    app = await boot({ draftVariantOverride: 4018 });
    const { orderId, token } = await payFor(app);
    expect(await stateOf(app, orderId, token)).toBe('submit_failed');
    const t = await app.run(listTransitions(orderId));
    expect(t._tag === 'Success' && t.value.at(-1)?.note).toMatch(/variant 4018, expected 4017/);
  });

  it('a rejected placement (bad file) → submit_failed', async () => {
    app = await boot({ placementFailure: 'front: file is not printable' });
    const { orderId, token } = await payFor(app);
    expect(await stateOf(app, orderId, token)).toBe('submit_failed');
  });

  it('a non-retryable provider rejection → submit_failed', async () => {
    app = await boot({ createRejects: 'Recipient address is invalid' });
    const { orderId, token, ack } = await payFor(app);
    expect(ack.body.outcome).toMatch(/^applied:submit=submit_failed/);
    expect(await stateOf(app, orderId, token)).toBe('submit_failed');
    expect(app.providerOrders()).toHaveLength(0);
  });

  it('an already-confirmed provider order found by external id is recorded without a new draft', async () => {
    app = await boot({ confirmRetryableFailures: 5 });
    const { orderId, token, sessionId } = await payFor(app);
    // Someone confirmed the draft in Printful's dashboard meanwhile.
    app.setProviderOrderStatus(app.providerOrders()[0]!.id, 'inprocess');
    await app.pspWebhook({ id: 'evt_2', type: 'checkout.session.completed', sessionId });
    expect(await stateOf(app, orderId, token)).toBe('submitted');
    expect(app.providerOrders()).toHaveLength(1);
  });
});
