import type { DesignResponse } from '@pressline/contract';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionResult } from '$lib/server/operator/actions';
import type { OrderDetail } from '$lib/server/operator/read';
import type { Quote } from '$lib/server/quote/quote';
import { catalog, offers } from './fixtures/catalog';
import { png } from './fixtures/images';
import { makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness';

type Detail = typeof OrderDetail.Type;

/**
 * Operator order actions (ticket #17) at seam 1: every action is a
 * Transition with Cause `cli`, every refusal is a 422 that says why.
 */
const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
};
const URL_OK = 'https://engine.test/files/heron/front.png';
const boot = (orders?: { createRejects?: string; createRetryableFailures?: number }) =>
  makeTestApp({
    config: { catalog: { offers }, checkout: { publicUrl: 'https://shop.example' } },
    catalog: orders ? { ...catalog, orders } : catalog,
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
const json = { ...bearer, 'content-type': 'application/json' };
const anna = {
  name: 'Anna Example',
  address1: 'Torstraße 1',
  city: 'Berlin',
  zip: '10119',
  country: 'DE',
  email: 'anna@example.com',
};
const post = <T>(app: TestApp, path: string, body?: unknown) =>
  app.json<T>(path, {
    method: 'POST',
    headers: json,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const detail = async (app: TestApp, id: string) =>
  (await app.json<Detail>(`/api/operator/orders/${id}`, { headers: bearer })).body;
const create = (app: TestApp, extra: Record<string, unknown> = {}) =>
  post<ActionResult>(app, '/api/operator/orders', {
    engine: 'sample',
    designId: design.id,
    offer: 'tee-black-front',
    variant: 'black-m',
    recipient: anna,
    paidOutside: true,
    ...extra,
  });

/** A Storefront order paid through the PSP, so cancel/purge have realistic material. */
let seq = 0;
const storefrontPaid = async (app: TestApp) => {
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
    paymentIntentId: `pi_${++seq}`,
    amountTotal: 3479,
    amountTax: 500,
    consentAccepted: true,
    customer: { email: anna.email, name: anna.name },
    shipping: {
      name: anna.name,
      address1: anna.address1,
      city: anna.city,
      zip: anna.zip,
      country: 'DE',
    },
  });
  await app.pspWebhook({
    id: `evt_${++seq}`,
    type: 'checkout.session.completed',
    sessionId: session,
  });
  return body.orderId;
};

describe('orders create', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('creates a paid-outside Order, ensures the Printfile, submits it, and records Cause cli throughout', async () => {
    app = await boot();
    const res = await create(app);
    expect(res.status).toBe(200);
    const d = res.body.detail;
    expect(d.order.state).toBe('submitted');
    expect(d.order.recipient).toMatchObject({ name: 'Anna Example', country: 'DE' });
    expect(d.order.amountTotal).toBe(d.order.retail + d.order.shipping);
    expect(d.order.psp.sessionId).toBeUndefined();
    expect(d.transitions.map((t) => [t.to, t.cause])).toEqual([
      ['checkout_open', 'cli'],
      ['paid', 'cli'],
      ['submitted', 'cli'],
    ]);
    expect(d.transitions[1]?.note).toBe('paid outside the PSP');
    expect(res.body.outcome).toMatch(/^submit: submitted provider order .*; email: not requested$/);
    expect(app.providerOrders().at(-1)).toMatchObject({
      externalId: d.order.id,
      status: 'pending',
    });
    expect(await app.sentMail()).toEqual([]);

    // With `email: true` the Customer gets the same confirmation as a Storefront order.
    const mailed = await create(app, { email: true });
    expect(mailed.body.outcome).toMatch(/email: sent$/);
    expect((await app.sentMail()).map((m) => m.to)).toEqual(['anna@example.com']);
  });

  it('refuses without paid-outside, for a design that cannot be ordered, and when the provider rejects', async () => {
    app = await boot();
    const flag = await create(app, { paidOutside: false });
    expect(flag.status).toBe(400);
    const nope = await create(app, { designId: 'nope' });
    expect(nope.status).toBe(422);
    const unknown = await create(app, { variant: 'xl' });
    expect(unknown.status).toBe(422);
    expect((unknown.body as unknown as { message: string }).message).toMatch(/not available/);
    await app.dispose();

    app = await boot({ createRejects: 'bad address' });
    const rejected = await create(app);
    expect(rejected.status).toBe(200);
    expect(rejected.body.detail.order.state).toBe('submit_failed');
    expect(rejected.body.outcome).toContain('submit: submit_failed (bad address)');
  });
});

describe('orders resubmit and fix-address', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('resubmits from submit_failed and refuses elsewhere', async () => {
    app = await boot({ createRetryableFailures: 4 });
    const id = (await create(app)).body.detail.order.id;
    // The manual create's own submit exhausted its retries: still paid.
    expect((await detail(app, id)).order.state).toBe('paid');
    const early = await post<ActionResult>(app, `/api/operator/orders/${id}/resubmit`);
    expect(early.status).toBe(422);
    expect((early.body as unknown as { message: string }).message).toBe(
      'cannot resubmit an Order in paid (needs submit_failed or on_hold)',
    );
    await app.dispose();

    app = await boot({ createRejects: 'bad address' });
    const failed = (await create(app)).body.detail.order.id;
    const again = await post<ActionResult>(app, `/api/operator/orders/${failed}/resubmit`);
    // The provider still rejects: refused with the reason, and the Order stays submit_failed.
    expect(again.status).toBe(422);
    expect((again.body as unknown as { message: string }).message).toContain('bad address');
    expect((await detail(app, failed)).order.state).toBe('submit_failed');
    expect((await post(app, '/api/operator/orders/nope/resubmit')).status).toBe(404);
  });

  it('fix-address replaces the Recipient, fixes the provider draft, and resubmits with Cause cli', async () => {
    app = await boot({ createRejects: 'bad address' });
    const id = (await create(app)).body.detail.order.id;
    expect((await detail(app, id)).order.state).toBe('submit_failed');
    // The Operator corrects the address; the memory provider accepts the next create.
    const abroad = await post<ActionResult>(app, `/api/operator/orders/${id}/address`, {
      recipient: { ...anna, country: 'FR' },
    });
    expect(abroad.status).toBe(422);
    expect((abroad.body as unknown as { message: string }).message).toContain('quoted for DE');
    const fixed = await post<ActionResult>(app, `/api/operator/orders/${id}/address`, {
      recipient: { ...anna, address1: 'Torstraße 2' },
    });
    // No provider draft exists (create was rejected), so the Recipient is stored and the resubmit
    // runs; the fixture keeps rejecting, which is reported and leaves the Order in submit_failed.
    expect(fixed.status).toBe(422);
    const d = await detail(app, id);
    expect(d.order.recipient?.address1).toBe('Torstraße 2');
    expect(d.order.state).toBe('submit_failed');
    await app.dispose();
    // Wrong state: refused before anything is touched.
    app = await boot();
    const paid = await storefrontPaid(app);
    const wrongState = await post<ActionResult>(app, `/api/operator/orders/${paid}/address`, {
      recipient: anna,
    });
    expect(wrongState.status).toBe(422);
    expect((wrongState.body as unknown as { message: string }).message).toContain(
      'cannot fix the address of an Order in submitted',
    );
  });

  it('resubmits an on_hold Order by confirming the provider order again', async () => {
    app = await boot();
    const id = await storefrontPaid(app);
    const providerOrderId = (await detail(app, id)).order.providerOrderId!;
    app.setProviderOrderStatus(providerOrderId, 'onhold');
    await app.printfulWebhook({
      type: 'order_put_hold',
      occurred_at: new Date().toISOString(),
      data: { order: { id: providerOrderId, external_id: id } },
    });
    expect((await detail(app, id)).order.state).toBe('on_hold');
    const fixed = await post<ActionResult>(app, `/api/operator/orders/${id}/address`, {
      recipient: { ...anna, address1: 'Torstraße 3' },
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.detail.order.state).toBe('submitted');
    expect(fixed.body.detail.transitions.at(-1)).toMatchObject({
      from: 'on_hold',
      to: 'submitted',
      cause: 'cli',
      note: 'address corrected by the Operator',
    });
  });
});

describe('orders cancel', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('cancels at the provider while it can, records canceled, and never refunds', async () => {
    app = await boot();
    const id = await storefrontPaid(app);
    const res = await post<ActionResult>(app, `/api/operator/orders/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.detail.order.state).toBe('canceled');
    expect(res.body.outcome).toMatch(/^provider order \d+ canceled; no refund was made/);
    expect(res.body.detail.transitions.at(-1)).toMatchObject({ to: 'canceled', cause: 'cli' });
    expect(app.providerOrders().at(-1)?.status).toBe('canceled');
    const again = await post<ActionResult>(app, `/api/operator/orders/${id}/cancel`);
    expect(again.status).toBe(422);
    expect((again.body as unknown as { message: string }).message).toBe(
      'cannot cancel an Order in canceled (needs checkout_open or paid or submit_failed or submitted or on_hold or in_production or shipped)',
    );
  });

  it('expires the checkout session when canceling an open checkout, so a late payment cannot land', async () => {
    app = await boot();
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
    const res = await post<ActionResult>(app, `/api/operator/orders/${body.orderId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toContain('checkout session expired at the PSP');
    const session = (await app.pspSessions()).at(-1)!.session.id;
    // The webhook for a payment that somehow completed is ignored: the session reads expired.
    await app.pspWebhook({
      id: 'evt_late',
      type: 'checkout.session.completed',
      sessionId: session,
    });
    expect((await detail(app, body.orderId)).order.state).toBe('canceled');
  });

  it('tells the Operator when the provider is already producing it', async () => {
    app = await boot();
    const id = await storefrontPaid(app);
    app.setProviderOrderStatus((await detail(app, id)).order.providerOrderId!, 'inprocess');
    const res = await post<ActionResult>(app, `/api/operator/orders/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.detail.order.state).toBe('canceled');
    expect(res.body.outcome).toContain(
      'could not be canceled through the API; contact the provider',
    );
  });
});

describe('orders purge', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('strips Recipient and consent from terminal Orders older than the threshold, keeping country and totals', async () => {
    app = await boot();
    const old = await storefrontPaid(app);
    await post(app, `/api/operator/orders/${old}/cancel`);
    app.advanceClock('40 days');
    const recent = await storefrontPaid(app);
    await post(app, `/api/operator/orders/${recent}/cancel`);
    const live = await storefrontPaid(app);
    app.advanceClock('40 days');

    const res = await post<{ purged: number }>(app, '/api/operator/orders/purge', {
      olderThanDays: 60,
    });
    expect(res.body).toEqual({ purged: 1 });
    const purged = (await detail(app, old)).order;
    expect(purged.recipient).toBeUndefined();
    expect(purged.consentAcceptedAt).toBeUndefined();
    expect(purged.purgedAt).toBeDefined();
    expect(purged.country).toBe('DE');
    expect(purged.amountTotal).toBe(3479);
    expect((await detail(app, recent)).order.recipient).toBeDefined();
    // Live Orders are never purged, however old.
    expect((await detail(app, live)).order.recipient).toBeDefined();
    // Idempotent.
    expect(
      (await post<{ purged: number }>(app, '/api/operator/orders/purge', { olderThanDays: 60 }))
        .body,
    ).toEqual({ purged: 0 });
  });
});
