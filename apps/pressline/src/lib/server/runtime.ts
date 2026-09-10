import { Effect, Layer } from 'effect';
import rawConfig from '../../../pressline.config';
import { Config } from './config/schema';
import { layerSqliteNode } from './db/sqlite-node';
import { migrate } from './db/migrate';
import { makeWebHandler, type WebHandler } from './http/handler';
import { layerDesignSourceMemory } from './services/design-source';
import { layerFulfilmentProviderMemory } from './services/fulfilment-provider';
import { layerMailerConsole } from './services/mailer';
import { layerPspMemory } from './services/psp';
import { PROTOCOL_VERSION } from './http/api';

/**
 * Production wiring, memoised per isolate (ADR-0012). Platform bindings (D1,
 * secrets) arrive via `event.platform`; the platform tickets swap the Db and
 * provider layers per environment. Until the provider tickets land, the
 * providers are the in-memory ones.
 */
let cached: WebHandler | undefined;

export const getWebHandler = (platform: App.Platform | undefined): WebHandler => {
  if (cached) return cached;
  const env = platform?.env ?? process.env;
  const dbPath = typeof env['DATABASE_PATH'] === 'string' ? env['DATABASE_PATH'] : './pressline.db';

  const DbLive = layerSqliteNode(dbPath);
  // Boot-time migrations: run once while the Db layer is built.
  const DbMigrated = Layer.effectDiscard(migrate()).pipe(Layer.provide(DbLive));

  const services = Layer.mergeAll(
    Config.layer(rawConfig),
    Layer.merge(DbLive, DbMigrated),
    layerDesignSourceMemory({ protocolVersion: PROTOCOL_VERSION }),
    layerFulfilmentProviderMemory,
    layerPspMemory,
    layerMailerConsole,
  ).pipe(Layer.tapErrorCause((c) => Effect.logError('boot failed', c)));

  cached = makeWebHandler(services);
  return cached;
};
