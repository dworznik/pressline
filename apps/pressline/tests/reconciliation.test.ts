import type { DesignResponse } from '@pressline/contract';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderDetail } from '$lib/server/operator/read';
import type { Quote } from '$lib/server/quote/quote';
import type { ReconciliationReport } from '$lib/server/reconciliation/run';
import { catalog, offers } from './fixtures/catalogue';
import { png } from './fixtures/images';
import { CRON_SECRET, makeTestApp, OPERATOR_TOKEN, type TestApp } from './harness';

type Detail = typeof OrderDetail.Type;

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
    config: { catalogue: { offers }, email: { operator: 'ops@shop.example' } },
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
const paidSession = {
  status: 'complete' as const,
  paymentStatus: 'paid' as const,
  paymentIntentId: 'pi_3Test123',
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
};
let seq = 0;

const checkout = async (app: TestApp) => {
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
  return { orderId: body.orderId, session };
};
const pay = async (app: TestApp, session: string, paymentIntentId = `pi_${++seq}`) => {
  app.setPspSession(session, { ...paidSession, paymentIntentId });
  await app.pspWebhook({
    id: `evt_${++seq}`,
    type: 'checkout.session.completed',
    sessionId: session,
  });
};
const reconcile = async (app: TestApp) => {
  const res = await app.json<ReconciliationReport>('/api/operator/reconcile', {
    method: 'POST',
    headers: bearer,
  });
  expect(res.status).toBe(200);
  return res.body;
};
const detail = async (app: TestApp, id: string) =>
  (await app.json<Detail>(`/api/operator/orders/${id}`, { headers: bearer })).body;

describe('Reconciliation entry points', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('runs from the operator API, persists the report, and the cron route needs its own secret', async () => {
    app = await boot();
    const report = await reconcile(app);
    expect(report.trigger).toBe('operator');
    expect(Object.keys(report.steps)).toEqual([
      'staleCheckouts',
      'stuckPaid',
      'providerCatchUp',
      'refundsAndDisputes',
      'inboundEvents',
      'emails',
      'engines',
      'catalogue',
    ]);
    expect(report.alarms).toEqual([]);
    const latest = await app.json<ReconciliationReport>('/api/operator/reconciliation/latest', {
      headers: bearer,
    });
    expect(latest.body).toEqual(report);

    expect((await app.fetch('/api/cron/reconcile')).status).toBe(401);
    expect((await app.fetch('/api/cron/reconcile', { headers: bearer })).status).toBe(401);
    const cron = await app.json<ReconciliationReport>('/api/cron/reconcile', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(cron.status).toBe(200);
    expect(cron.body.trigger).toBe('cron');
    // A quiet run emails nobody.
    expect(await app.sentMail()).toEqual([]);
  });
});

describe('Reconciliation repairs', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('expires stale checkouts, and settles one that was paid but never announced', async () => {
    app = await boot();
    const abandoned = await checkout(app);
    const missedWebhook = await checkout(app);
    const fresh = await checkout(app);
    app.setPspSession(missedWebhook.session, { ...paidSession, paymentIntentId: 'pi_missed' });
    app.advanceClock('25 hours');
    const late = await checkout(app);

    const report = await reconcile(app);
    expect(report.steps.staleCheckouts).toMatchObject({ checked: 3, repaired: 3 });
    expect((await detail(app, abandoned.orderId)).order.state).toBe('expired');
    expect((await detail(app, fresh.orderId)).order.state).toBe('expired');
    expect((await detail(app, late.orderId)).order.state).toBe('checkout_open');
    const settled = await detail(app, missedWebhook.orderId);
    expect(settled.order.state).toBe('submitted');
    expect(settled.transitions.map((t) => [t.to, t.cause])).toEqual([
      ['checkout_open', 'storefront'],
      ['paid', 'reconciliation'],
      ['submitted', 'reconciliation'],
    ]);
    expect((await app.sentMail()).map((m) => m.subject)).toHaveLength(1);
  });

  it('submits a paid Order the webhook could not, and alarms for one that failed outright', async () => {
    // Four retryable failures exhaust the webhook's retry budget; the Order stays paid.
    app = await boot({ createRetryableFailures: 4 });
    const { orderId, session } = await checkout(app);
    await pay(app, session);
    expect((await detail(app, orderId)).order.state).toBe('paid');
    // Not yet stale: left alone.
    app.advanceClock('5 minutes');
    let report = await reconcile(app);
    expect(report.steps.stuckPaid).toMatchObject({ checked: 0 });
    app.advanceClock('11 minutes');
    report = await reconcile(app);
    expect(report.steps.stuckPaid).toMatchObject({ checked: 1, repaired: 1 });
    expect(report.alarms).toEqual([]);
    const d = await detail(app, orderId);
    expect(d.order.state).toBe('submitted');
    expect(d.transitions.at(-1)).toMatchObject({ to: 'submitted', cause: 'reconciliation' });
    await app.dispose();

    app = await boot({ createRejects: 'Printful is unhappy' });
    const failed = await checkout(app);
    await pay(app, failed.session);
    expect((await detail(app, failed.orderId)).order.state).toBe('submit_failed');
    report = await reconcile(app);
    expect(report.alarms).toEqual([
      {
        kind: 'submit_failed',
        orderId: failed.orderId,
        message: 'submission failed; fix and resubmit',
      },
    ]);
    const mail = await app.sentMail();
    expect(mail.at(-1)?.to).toBe('ops@shop.example');
    expect(mail.at(-1)?.subject).toBe('Test Shop: 1 thing needs attention');
    expect(mail.at(-1)?.text).toContain(failed.orderId);
  });

  it('catches up provider status the webhooks missed', async () => {
    app = await boot();
    const { orderId, session } = await checkout(app);
    await pay(app, session);
    const providerOrderId = (await detail(app, orderId)).order.providerOrderId!;
    app.setProviderOrderStatus(providerOrderId, 'inprocess');
    let report = await reconcile(app);
    expect(report.steps.providerCatchUp).toMatchObject({ checked: 1, repaired: 1 });
    expect((await detail(app, orderId)).order.state).toBe('in_production');

    app.setProviderOrderStatus(providerOrderId, 'onhold');
    report = await reconcile(app);
    expect((await detail(app, orderId)).order.state).toBe('on_hold');
    expect(report.alarms).toEqual([
      { kind: 'on_hold', orderId, message: 'provider has the order on hold' },
    ]);

    // Nothing changed: nothing repaired, no new Transition, same Alarm.
    report = await reconcile(app);
    expect(report.steps.providerCatchUp?.repaired).toBe(0);
    expect((await detail(app, orderId)).transitions.filter((t) => t.to === 'on_hold')).toHaveLength(
      1,
    );
  });

  it('records refunds and disputes the Operator handled at the PSP', async () => {
    // The provider is unreachable, so every Order below stays paid (not yet stale).
    app = await boot({ createRetryableFailures: 100 });
    const a = await checkout(app);
    await pay(app, a.session, 'pi_refunded');
    const b = await checkout(app);
    await pay(app, b.session, 'pi_disputed');
    app.setPspPayment('pi_refunded', { refunded: true, amountRefunded: 3479, disputed: false });
    app.setPspPayment('pi_disputed', { refunded: false, amountRefunded: 0, disputed: true });

    const report = await reconcile(app);
    expect(report.alarms).toEqual([
      { kind: 'refund', orderId: a.orderId, message: 'refund of 3479 recorded' },
      { kind: 'dispute', orderId: b.orderId, message: 'payment is disputed at the PSP' },
    ]);
    const refunded = await detail(app, a.orderId);
    expect(refunded.order.state).toBe('refunded');
    expect(refunded.transitions.at(-1)).toMatchObject({
      to: 'refunded',
      cause: 'reconciliation',
      causeRef: 'pi_refunded',
    });
    expect((await detail(app, b.orderId)).order.state).toBe('paid');
    // Already recorded: the next run does not repeat the Transition.
    await reconcile(app);
    expect(
      (await detail(app, a.orderId)).transitions.filter((t) => t.to === 'refunded'),
    ).toHaveLength(1);
  });

  it('does not record a refund on an Order the provider already has; it alarms instead', async () => {
    app = await boot();
    const { orderId, session } = await checkout(app);
    await pay(app, session, 'pi_late_refund');
    app.setPspPayment('pi_late_refund', { refunded: true, amountRefunded: 3479, disputed: false });
    const report = await reconcile(app);
    expect(report.alarms).toEqual([
      {
        kind: 'refund',
        orderId,
        message: 'refund of 3479 seen while submitted; not recorded (state machine)',
      },
    ]);
    expect((await detail(app, orderId)).order.state).toBe('submitted');
  });

  it('retries failed emails and reprocesses an Inbound Event whose claim lapsed', async () => {
    app = await boot();
    const { orderId, session } = await checkout(app);
    app.mailerDown(true);
    await pay(app, session);
    expect(await app.sentMail()).toEqual([]);
    app.mailerDown(false);
    const report = await reconcile(app);
    expect(report.steps.emails).toMatchObject({ checked: 1, repaired: 1 });
    expect((await app.sentMail()).map((m) => m.subject)).toHaveLength(1);
    expect((await detail(app, orderId)).emails.map((e) => e.kind)).toEqual(['confirmation']);
  });

  it('reports Engines that are down and a Catalogue that no longer resolves', async () => {
    app = await makeTestApp({
      config: { catalogue: { offers }, email: { operator: 'ops@shop.example' } },
      catalog,
      engines: { engines: { sample: { designs: {}, down: true } } },
    });
    const report = await reconcile(app);
    expect(report.alarms.map((a) => a.kind)).toEqual(['engine_disabled']);
    expect(report.steps.engines).toMatchObject({ checked: 1 });
    const mail = await app.sentMail();
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toContain('1 thing needs attention');
  });
});

describe('Reconciliation replays Inbound Events', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('reprocesses a delivery that failed and was released', async () => {
    app = await boot();
    const { orderId, session } = await checkout(app);
    app.setPspSession(session, { ...paidSession, paymentIntentId: 'pi_replay' });
    app.pspDown(true);
    const failed = await app.pspWebhook({
      id: 'evt_replay',
      type: 'checkout.session.completed',
      sessionId: session,
    });
    expect(failed.status).toBe(500);
    expect((await detail(app, orderId)).order.state).toBe('checkout_open');
    app.pspDown(false);
    const report = await reconcile(app);
    expect(report.steps.inboundEvents).toMatchObject({ checked: 1, repaired: 1 });
    const d = await detail(app, orderId);
    expect(d.order.state).toBe('submitted');
    expect(d.inboundEvents.map((e) => [e.eventId, e.outcome])).toEqual([['evt_replay', 'applied']]);
    // Settled now: a second run finds nothing to replay.
    expect((await reconcile(app)).steps.inboundEvents).toMatchObject({ checked: 0 });
  });
});
