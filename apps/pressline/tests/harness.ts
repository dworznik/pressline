import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Clock, Duration, Effect, Layer } from 'effect';
import { Config, type PresslineConfigSchema } from '$lib/server/config/schema';
import { layerSqliteMigrated } from '$lib/server/db/layer';
import { makeWebHandler } from '$lib/server/http/handler';
import {
  emptyCatalog,
  layerDesignSourceMemory,
  layerPspMemory,
  makeFulfilmentProviderMemory,
  makeMailerMemory,
  type MemoryCatalog,
} from '$lib/server/services/memory';

/**
 * Seam 1 (docs/SPEC.md → Testing Decisions): boot the bridge's HTTP surface
 * with in-memory services, a temp SQLite file and a controllable clock, then
 * talk to it over HTTP. Tests assert on responses, subsequent reads, and what
 * the fakes received.
 */
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
}

export interface TestApp {
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly json: <T = unknown>(
    path: string,
    init?: RequestInit,
  ) => Promise<{ status: number; body: T }>;
  readonly sentMail: () => Promise<ReadonlyArray<{ to: string; subject: string }>>;
  /** How many calls reached the (in-memory) fulfilment provider. */
  readonly fulfilmentProviderCalls: () => Promise<number>;
  /** Move the app's clock forward. */
  readonly advanceClock: (by: Duration.DurationInput) => void;
  readonly dbPath: string;
  /** Release the app. `keepDb` leaves the database on disk for a successor app. */
  readonly dispose: (options?: { keepDb?: boolean }) => Promise<void>;
}

/** A clock the test moves by hand; starts at the real time so TTLs are realistic. */
const makeSettableClock = () => {
  let now = Date.now();
  const clock: Clock.Clock = {
    ...Clock.make(),
    unsafeCurrentTimeMillis: () => now,
    unsafeCurrentTimeNanos: () => BigInt(now) * 1_000_000n,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
  };
  return { clock, advance: (by: Duration.DurationInput) => void (now += Duration.toMillis(by)) };
};

export const makeTestApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const dir = options.dbPath ? dirname(options.dbPath) : mkdtempSync(join(tmpdir(), 'pressline-'));
  const dbPath = options.dbPath ?? join(dir, 'test.db');
  const mailer = await Effect.runPromise(makeMailerMemory);
  const provider = await Effect.runPromise(
    makeFulfilmentProviderMemory(options.catalog ?? emptyCatalog),
  );
  const { clock, advance } = makeSettableClock();

  const services = Layer.mergeAll(
    Config.layer({ ...testConfig, ...options.config }),
    layerSqliteMigrated(dbPath),
    layerDesignSourceMemory(),
    provider.layer,
    layerPspMemory,
    mailer.layer,
  ).pipe(Layer.provideMerge(Layer.setClock(clock)));
  const { handler, dispose } = makeWebHandler(services);
  const base = 'http://pressline.test';

  const fetch = (path: string, init?: RequestInit) => handler(new Request(base + path, init));
  return {
    fetch,
    json: async (path, init) => {
      const res = await fetch(path, init);
      return { status: res.status, body: (await res.json()) as never };
    },
    sentMail: () => Effect.runPromise(mailer.sent),
    fulfilmentProviderCalls: () => Effect.runPromise(provider.calls),
    advanceClock: advance,
    dbPath,
    dispose: async ({ keepDb = false } = {}) => {
      await dispose();
      if (!keepDb) rmSync(dir, { recursive: true, force: true });
    },
  };
};
