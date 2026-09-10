import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { Config, type PresslineConfigSchema } from '$lib/server/config/schema';
import { migrate } from '$lib/server/db/migrate';
import { layerSqliteNode } from '$lib/server/db/sqlite-node';
import { PROTOCOL_VERSION } from '$lib/server/http/api';
import { makeWebHandler } from '$lib/server/http/handler';
import { layerDesignSourceMemory } from '$lib/server/services/design-source';
import {
  emptyCatalog,
  makeFulfilmentProviderMemory,
  type MemoryCatalog,
} from '$lib/server/services/fulfilment-provider';
import { makeMailerMemory } from '$lib/server/services/mailer';
import { layerPspMemory } from '$lib/server/services/psp';

/**
 * Seam 1 (docs/SPEC.md → Testing Decisions): boot the bridge's HTTP surface
 * with in-memory services and a temp SQLite file, then talk to it over HTTP.
 * Tests assert on responses, subsequent reads, and what the fakes received.
 */
export const testConfig: typeof PresslineConfigSchema.Encoded = {
  name: 'Test Shop',
  currency: 'EUR',
  engines: [{ slug: 'sample', baseUrl: 'http://engine.test' }],
};

export interface TestApp {
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly json: <T = unknown>(
    path: string,
    init?: RequestInit,
  ) => Promise<{ status: number; body: T }>;
  readonly sentMail: () => Promise<ReadonlyArray<{ to: string; subject: string }>>;
  /** How many calls reached the (in-memory) fulfilment provider. */
  readonly providerCalls: () => Promise<number>;
  readonly dbPath: string;
  readonly dispose: () => Promise<void>;
}

export interface TestAppOptions {
  readonly config?: Partial<typeof PresslineConfigSchema.Encoded>;
  /** Seed for the in-memory fulfilment provider's catalog. */
  readonly catalog?: MemoryCatalog;
}

export const makeTestApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const overrides = options.config ?? {};
  const dir = mkdtempSync(join(tmpdir(), 'pressline-'));
  const dbPath = join(dir, 'test.db');
  const mailer = await Effect.runPromise(makeMailerMemory);
  const provider = await Effect.runPromise(
    makeFulfilmentProviderMemory(options.catalog ?? emptyCatalog),
  );

  const DbLive = layerSqliteNode(dbPath);
  const services = Layer.mergeAll(
    Config.layer({ ...testConfig, ...overrides }),
    Layer.merge(DbLive, Layer.effectDiscard(migrate()).pipe(Layer.provide(DbLive))),
    layerDesignSourceMemory({ protocolVersion: PROTOCOL_VERSION }),
    provider.layer,
    layerPspMemory,
    mailer.layer,
  );
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
    providerCalls: () => Effect.runPromise(provider.calls),
    dbPath,
    dispose: async () => {
      await dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
