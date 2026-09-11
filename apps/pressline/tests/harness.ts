import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FetchHttpClient } from '@effect/platform';
import { Clock, Duration, Effect, type Exit, Layer, ManagedRuntime } from 'effect';
import { Config, type PresslineConfigSchema } from '$lib/server/config/schema';
import { layerSqliteMigrated } from '$lib/server/db/layer';
import { makeWebHandler, type Services } from '$lib/server/http/handler';
import { InstanceFacts } from '$lib/server/operator/instance';
import { OperatorSecrets } from '$lib/server/operator/auth';
import type { ProviderOrder, ProviderShipment } from '$lib/server/services/fulfilment-provider';
import type { Email } from '$lib/server/services/mailer';
import type {
  CheckoutSession,
  CheckoutSessionDetails,
  CheckoutSessionInput,
  PaymentStatus,
} from '$lib/server/services/psp';
import {
  emptyCatalog,
  makeDesignSourceMemory,
  makePspMemory,
  makeFulfilmentProviderMemory,
  makeMailerMemory,
  type DesignSourceMemoryOptions,
  type MemoryCatalog,
} from '$lib/server/services/memory';

/**
 * Seam 1 (docs/SPEC.md → Testing Decisions): boot the bridge's HTTP surface
 * with in-memory services, a temp SQLite file and a controllable clock, then
 * talk to it over HTTP. Tests assert on responses, subsequent reads, and what
 * the fakes received.
 */
/** The Operator's credential in tests (bearer for the CLI, exchanged for a cookie by the view). */
export const OPERATOR_TOKEN = 'operator-token-for-tests';
export const CRON_SECRET = 'cron-secret-for-tests';

export const testConfig: typeof PresslineConfigSchema.Encoded = {
  name: 'Test Shop',
  currency: 'EUR',
  engines: [{ slug: 'sample', baseUrl: 'http://engine.test' }],
};

export interface TestAppOptions {
  readonly config?: Partial<typeof PresslineConfigSchema.Encoded>;
  /** Seed for the in-memory fulfilment provider's catalog. */
  readonly catalog?: MemoryCatalog;
  /** Reuse an existing database (from a previous app's `dbPath`) instead of a fresh temp one. */
  readonly dbPath?: string;
  /** Seed for the in-memory Engines. Defaults to one healthy, empty Engine `sample`. */
  readonly engines?: DesignSourceMemoryOptions;
  /** Files the Engine "hosts": what a ranged GET of a Printfile URL returns. */
  readonly files?: Readonly<Record<string, HostedFile>>;
}

export interface HostedFile {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Answer with this status instead of serving the file. */
  readonly status?: number;
  /** Ignore Range and answer 200 with the whole body. */
  readonly ignoreRange?: boolean;
}

/** Serves the harness's hosted files with Range support; anything else is 404. */
const makeHostedFetch =
  (files: Readonly<Record<string, HostedFile>>, served: Map<string, number>): typeof fetch =>
  async (input, init) => {
    const req = new Request(input, init);
    const file = files[req.url];
    if (!file) return new Response('not found', { status: 404 });
    if (file.status) return new Response('', { status: file.status });
    // Stream in 16 KiB chunks and count every chunk handed out: a reader that
    // stops early (the header validator) is observable as bytes not served.
    const stream = (bytes: Uint8Array) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const offset = served.get(req.url) ?? 0;
          if (offset >= bytes.length) return controller.close();
          const chunk = bytes.slice(offset, offset + 16 * 1024);
          served.set(req.url, offset + chunk.length);
          controller.enqueue(chunk);
        },
      });
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') ?? '');
    if (range && !file.ignoreRange) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), file.bytes.length - 1);
      return new Response(stream(file.bytes.slice(start, end + 1)), {
        status: 206,
        headers: {
          'content-type': file.contentType,
          'content-range': `bytes ${start}-${end}/${file.bytes.length}`,
          'content-length': String(end - start + 1),
        },
      });
    }
    return new Response(stream(file.bytes), {
      status: 200,
      headers: { 'content-type': file.contentType, 'content-length': String(file.bytes.length) },
    });
  };

export interface TestApp {
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly json: <T = unknown>(
    path: string,
    init?: RequestInit,
  ) => Promise<{ status: number; body: T }>;
  readonly sentMail: () => Promise<ReadonlyArray<Email>>;
  /** Make the in-memory Mailer fail every send. */
  readonly mailerDown: (down: boolean) => void;
  /** How many calls reached the (in-memory) fulfilment provider. */
  readonly fulfilmentProviderCalls: () => Promise<number>;
  /** How many design/printfile calls reached the (in-memory) Engines. */
  readonly engineCalls: () => Promise<number>;
  /** Bytes the hosted-file stub handed to the app for a URL (what a real transfer would have cost). */
  readonly bytesServed: (url: string) => number;
  /** Orders the in-memory fulfilment provider holds. */
  readonly providerOrders: () => ReadonlyArray<ProviderOrder>;
  /** Change a provider order's status (simulates Printful moving it). */
  readonly setProviderOrderStatus: (id: string, status: ProviderOrder['status']) => void;
  /** What the in-memory provider reports as shipments for one of its orders. */
  readonly setProviderShipments: (id: string, list: ReadonlyArray<ProviderShipment>) => void;
  /** Deliver a Printful-shaped webhook the in-memory provider will accept (signature `memory:valid` unless overridden). */
  readonly printfulWebhook: (
    body: {
      type: string;
      occurred_at?: string;
      data?: {
        order?: { id: string; external_id?: string; status?: string };
        shipment?: { id: string; status?: string };
      };
    },
    signature?: string,
  ) => Promise<{ status: number; body: { outcome?: string; message?: string } }>;
  /** Checkout sessions the in-memory PSP was asked to create. */
  readonly pspSessions: () => Promise<
    ReadonlyArray<{ input: CheckoutSessionInput; session: CheckoutSession }>
  >;
  /** Make the in-memory PSP fail every call (simulates an outage). */
  readonly pspDown: (down: boolean) => void;
  /** What a re-fetch of a PSP session returns from now on (e.g. after the Customer paid). */
  readonly setPspSession: (id: string, patch: Partial<CheckoutSessionDetails>) => void;
  /** What the PSP reports for a payment intent (refunds, disputes). */
  readonly setPspPayment: (paymentIntentId: string, status: PaymentStatus) => void;
  /** Deliver a webhook the in-memory PSP will accept (signature `memory:valid` unless overridden). */
  readonly pspWebhook: (
    body: { id: string; type: string; sessionId?: string; created?: number },
    signature?: string,
  ) => Promise<{ status: number; body: { outcome?: string; message?: string } }>;
  /** Move the app's clock forward. */
  readonly advanceClock: (by: Duration.DurationInput) => void;
  /** Run an Effect against the app's services (for probing below the HTTP seam when debugging). */
  readonly run: <A, E>(eff: Effect.Effect<A, E, Services>) => Promise<Exit.Exit<A, unknown>>;
  readonly dbPath: string;
  /** Release the app. `keepDb` leaves the database on disk for a successor app. */
  readonly dispose: (options?: { keepDb?: boolean }) => Promise<void>;
}

/** Real time plus an offset the test moves by hand, so timeouts and poll loops still see time pass. */
const makeSettableClock = () => {
  let offset = 0;
  const now = () => Date.now() + offset;
  const base = Clock.make();
  const clock: Clock.Clock = {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    // Real sleeps (timeouts, poll intervals); only "what time is it" is settable.
    sleep: (duration) => base.sleep(duration),
    unsafeCurrentTimeMillis: now,
    unsafeCurrentTimeNanos: () => BigInt(now()) * 1_000_000n,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
  };
  return { clock, advance: (by: Duration.DurationInput) => void (offset += Duration.toMillis(by)) };
};

export const makeTestApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const dir = options.dbPath ? dirname(options.dbPath) : mkdtempSync(join(tmpdir(), 'pressline-'));
  const dbPath = options.dbPath ?? join(dir, 'test.db');
  const mailer = await Effect.runPromise(makeMailerMemory);
  const provider = await Effect.runPromise(
    makeFulfilmentProviderMemory(options.catalog ?? emptyCatalog),
  );
  const { clock, advance } = makeSettableClock();
  const psp = await Effect.runPromise(makePspMemory);
  const served = new Map<string, number>();
  const designSource = await Effect.runPromise(
    makeDesignSourceMemory(options.engines ?? { engines: { sample: {} } }),
  );

  const services = Layer.mergeAll(
    Config.layer({ ...testConfig, ...options.config }),
    Layer.succeed(OperatorSecrets, {
      token: OPERATOR_TOKEN,
      sessionSecret: 'session-secret-for-tests',
      cronSecret: CRON_SECRET,
    }),
    Layer.succeed(InstanceFacts, {
      mailer: 'memory',
      secrets: {
        printful: true,
        stripe: true,
        stripeWebhook: true,
        printfulWebhook: true,
        resend: false,
        sessionSecret: true,
        cron: true,
      },
    }),
    layerSqliteMigrated(dbPath),
    designSource.layer,
    provider.layer,
    psp.layer,
    mailer.layer,
    FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.succeed(FetchHttpClient.Fetch, makeHostedFetch(options.files ?? {}, served)),
      ),
    ),
  ).pipe(Layer.provideMerge(Layer.setClock(clock)));
  const { handler, dispose } = makeWebHandler(services);
  const runtime = ManagedRuntime.make(services);
  const base = 'http://pressline.test';

  const fetch = (path: string, init?: RequestInit) => handler(new Request(base + path, init));
  return {
    fetch,
    json: async (path, init) => {
      const res = await fetch(path, init);
      return { status: res.status, body: (await res.json()) as never };
    },
    sentMail: () => Effect.runPromise(mailer.sent),
    mailerDown: mailer.setDown,
    fulfilmentProviderCalls: () => Effect.runPromise(provider.calls),
    engineCalls: () => Effect.runPromise(designSource.calls),
    bytesServed: (url) => served.get(url) ?? 0,
    providerOrders: provider.providerOrders,
    setProviderOrderStatus: provider.setProviderOrderStatus,
    setProviderShipments: provider.setProviderShipments,
    printfulWebhook: async (body, signature = 'memory:valid') => {
      const res = await fetch('/webhooks/printful', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pf-webhook-signature': signature },
        body: JSON.stringify({
          occurred_at: new Date().toISOString(),
          retries: 0,
          store_id: 1,
          ...body,
        }),
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as never };
    },
    pspSessions: () => Effect.runPromise(psp.sessions),
    pspDown: psp.setDown,
    setPspSession: psp.setSession,
    setPspPayment: psp.setPayment,
    pspWebhook: async (body, signature = 'memory:valid') => {
      const res = await fetch('/webhooks/stripe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as never };
    },
    advanceClock: advance,
    run: (eff) => runtime.runPromiseExit(eff),
    dbPath,
    dispose: async ({ keepDb = false } = {}) => {
      await runtime.dispose();
      await dispose();
      if (!keepDb) rmSync(dir, { recursive: true, force: true });
    },
  };
};
