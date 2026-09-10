import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer, Schema } from 'effect';
import rawConfig from '../../../pressline.config';
import { Config } from './config/schema';
import { MailerKind } from './http/operator';
import { OperatorSecrets } from './operator/auth';
import { layerSqliteMigrated } from './db/layer';
import { makeWebHandler, type WebHandler } from './http/handler';
import { layerDesignSourceHttp } from './services/design-source-http';
import { layerMailerConsole, layerMailerNone } from './services/mailer';
import { layerResend } from './services/resend';
import { layerFulfilmentProviderMemory, layerPspMemory } from './services/memory';
import { layerPrintful } from './services/printful';
import { layerStripe } from './services/stripe';

/**
 * Secrets and platform settings (ADR-0014): validated like any other boundary.
 * Everything is optional so a fresh deploy boots before secrets are set; the
 * health endpoint and `doctor` report what is missing.
 */
const Env = Schema.Struct({
  DATABASE_PATH: Schema.optionalWith(Schema.NonEmptyString, { default: () => './pressline.db' }),
  PRINTFUL_TOKEN: Schema.optional(Schema.NonEmptyString),
  PRINTFUL_WEBHOOK_SECRET: Schema.optional(Schema.NonEmptyString),
  PRINTFUL_WEBHOOK_PUBLIC_KEY: Schema.optional(Schema.NonEmptyString),
  STRIPE_SECRET_KEY: Schema.optional(Schema.NonEmptyString),
  STRIPE_WEBHOOK_SECRET: Schema.optional(Schema.NonEmptyString),
  RESEND_API_KEY: Schema.optional(Schema.NonEmptyString),
  OPERATOR_TOKEN: Schema.optional(Schema.NonEmptyString),
  SESSION_SECRET: Schema.optional(Schema.NonEmptyString),
  MAILER: Schema.optionalWith(Schema.Literal('none', 'console'), {
    default: () => 'none' as const,
  }),
});

/** `ENGINE_SECRET_<SLUG>` with the slug upper-cased and dashes as underscores, e.g. `ENGINE_SECRET_MY_ENGINE`. */
export const engineSecretVar = (slug: string) =>
  `ENGINE_SECRET_${slug.toUpperCase().replaceAll('-', '_')}`;

/**
 * Production wiring, memoised per isolate (ADR-0012). Platform bindings (D1,
 * secrets) arrive via `event.platform`; the platform tickets swap the Db and
 * provider layers per environment. Until the provider tickets land, the
 * DesignSource and PSP are the in-memory stand-ins.
 */
let cached: WebHandler | undefined;

/** The cookie-signing secret, for the SvelteKit guard (same source as the runtime). */
export const operatorSessionSecret = (platform: App.Platform | undefined): string => {
  const rawEnv = (platform?.env ?? process.env) as Record<string, unknown>;
  const s = rawEnv['SESSION_SECRET'] ?? rawEnv['OPERATOR_TOKEN'];
  return typeof s === 'string' ? s : '';
};

export const getWebHandler = (platform: App.Platform | undefined): WebHandler => {
  if (cached) return cached;
  const rawEnv = (platform?.env ?? process.env) as Record<string, unknown>;
  const env = Schema.decodeUnknownSync(Env)(rawEnv, { onExcessProperty: 'ignore' });
  // Engines without a secret configured are wired with an empty one: the
  // startup health check then reports them as disabled rather than failing boot.
  const engines = rawConfig.engines.map((e) => {
    const secret = rawEnv[engineSecretVar(e.slug)];
    return { slug: e.slug, baseUrl: e.baseUrl, secret: typeof secret === 'string' ? secret : '' };
  });

  const FulfilmentProviderLive = env.PRINTFUL_TOKEN
    ? layerPrintful({
        token: env.PRINTFUL_TOKEN,
        ...(env.PRINTFUL_WEBHOOK_SECRET ? { webhookSecret: env.PRINTFUL_WEBHOOK_SECRET } : {}),
        ...(env.PRINTFUL_WEBHOOK_PUBLIC_KEY
          ? { webhookPublicKey: env.PRINTFUL_WEBHOOK_PUBLIC_KEY }
          : {}),
      })
    : layerFulfilmentProviderMemory;
  const PspLive = env.STRIPE_SECRET_KEY
    ? layerStripe({ secretKey: env.STRIPE_SECRET_KEY })
    : layerPspMemory;
  // Resend when a key and a sender are configured; `console` for local runs; else `none`.
  if (
    (env.RESEND_API_KEY && !rawConfig.email?.from) ||
    (!env.RESEND_API_KEY && rawConfig.email?.from)
  ) {
    throw new Error(
      'Mailer misconfigured: RESEND_API_KEY and pressline.config.ts email.from must be set together',
    );
  }
  const MailerLive =
    env.RESEND_API_KEY && rawConfig.email?.from
      ? layerResend({
          apiKey: env.RESEND_API_KEY,
          from: rawConfig.email.from,
          ...(rawConfig.email.replyTo ? { replyTo: rawConfig.email.replyTo } : {}),
        })
      : env.MAILER === 'console'
        ? layerMailerConsole
        : layerMailerNone;

  const mailerKind = env.RESEND_API_KEY ? 'resend' : env.MAILER === 'console' ? 'console' : 'none';
  // Without OPERATOR_TOKEN the operator API refuses everything (an empty token never matches).
  const OperatorSecretsLive = Layer.succeed(OperatorSecrets, {
    token: env.OPERATOR_TOKEN ?? '',
    sessionSecret: env.SESSION_SECRET ?? env.OPERATOR_TOKEN ?? '',
  });

  const services = Layer.mergeAll(
    Config.layer(rawConfig),
    OperatorSecretsLive,
    Layer.succeed(MailerKind, mailerKind),
    layerSqliteMigrated(env.DATABASE_PATH),
    layerDesignSourceHttp(engines),
    FulfilmentProviderLive,
    PspLive,
    MailerLive,
  ).pipe(
    // One outbound HTTP client for the Engine client, Printful and Printfile validation.
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.tapErrorCause((c) => Effect.logError('boot failed', c)),
  );

  cached = makeWebHandler(services);
  return cached;
};
