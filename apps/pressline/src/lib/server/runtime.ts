import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer, Schema } from 'effect';
import rawConfig from '../../../pressline.config';
import { Config } from './config/schema';
import { layerSqliteMigrated } from './db/layer';
import { makeWebHandler, type WebHandler } from './http/handler';
import { layerMailerConsole, layerMailerNone } from './services/mailer';
import {
  layerDesignSourceMemory,
  layerFulfilmentProviderMemory,
  layerPspMemory,
} from './services/memory';
import { layerPrintful } from './services/printful';

/**
 * Secrets and platform settings (ADR-0014): validated like any other boundary.
 * Everything is optional so a fresh deploy boots before secrets are set; the
 * health endpoint and `doctor` report what is missing.
 */
const Env = Schema.Struct({
  DATABASE_PATH: Schema.optionalWith(Schema.NonEmptyString, { default: () => './pressline.db' }),
  PRINTFUL_TOKEN: Schema.optional(Schema.NonEmptyString),
  MAILER: Schema.optionalWith(Schema.Literal('none', 'console'), {
    default: () => 'none' as const,
  }),
});

/**
 * Production wiring, memoised per isolate (ADR-0012). Platform bindings (D1,
 * secrets) arrive via `event.platform`; the platform tickets swap the Db and
 * provider layers per environment. Until the provider tickets land, the
 * DesignSource and PSP are the in-memory stand-ins.
 */
let cached: WebHandler | undefined;

export const getWebHandler = (platform: App.Platform | undefined): WebHandler => {
  if (cached) return cached;
  const env = Schema.decodeUnknownSync(Env)(platform?.env ?? process.env, {
    onExcessProperty: 'ignore',
  });

  const FulfilmentProviderLive = env.PRINTFUL_TOKEN
    ? layerPrintful({ token: env.PRINTFUL_TOKEN }).pipe(Layer.provide(FetchHttpClient.layer))
    : layerFulfilmentProviderMemory;
  // No real Mailer until ticket #12; `none` keeps Customers out of the logs.
  const MailerLive = env.MAILER === 'console' ? layerMailerConsole : layerMailerNone;

  const services = Layer.mergeAll(
    Config.layer(rawConfig),
    layerSqliteMigrated(env.DATABASE_PATH),
    layerDesignSourceMemory(),
    FulfilmentProviderLive,
    layerPspMemory,
    MailerLive,
  ).pipe(Layer.tapErrorCause((c) => Effect.logError('boot failed', c)));

  cached = makeWebHandler(services);
  return cached;
};
