import { FetchHttpClient } from '@effect/platform'
import { Effect, Layer, Schema } from 'effect'
import rawConfig from '../../../pressline.config'
import { assertDemoSafe } from './config/demo'
import { Config } from './config/schema'
import { InstanceFacts } from './operator/instance'
import { OperatorSecrets } from './operator/auth'
import { layerDbForPlatform } from './db/layer'
import { makeWebHandler, type WebHandler } from './http/handler'
import { layerDesignSourceHttp } from './services/design-source-http'
import { layerMailerConsole, layerMailerNone } from './services/mailer'
import { layerResend } from './services/resend'
import { demoFulfillmentProvider } from './services/demo'
import { layerFulfillmentProviderMemory, layerPspMemory } from './services/memory'
import { layerPrintful } from './services/printful'
import { layerStripe } from './services/stripe'
import { e2eConfig } from './e2e/config'

/**
 * Secrets and platform settings (ADR-0014): validated like any other boundary.
 * Everything is optional so a fresh deploy boots before secrets are set; the
 * health endpoint and `doctor` report what is missing.
 */
const Env = Schema.Struct({
  /** SQLite file for the Node deployable; Cloudflare binds D1, Vercel sets TURSO_DATABASE_URL (ADR-0008). */
  DATABASE_PATH: Schema.optional(Schema.NonEmptyString),
  TURSO_DATABASE_URL: Schema.optional(Schema.NonEmptyString),
  TURSO_AUTH_TOKEN: Schema.optional(Schema.NonEmptyString),
  PRINTFUL_TOKEN: Schema.optional(Schema.NonEmptyString),
  PRINTFUL_WEBHOOK_SECRET: Schema.optional(Schema.NonEmptyString),
  PRINTFUL_WEBHOOK_PUBLIC_KEY: Schema.optional(Schema.NonEmptyString),
  STRIPE_SECRET_KEY: Schema.optional(Schema.NonEmptyString),
  STRIPE_WEBHOOK_SECRET: Schema.optional(Schema.NonEmptyString),
  RESEND_API_KEY: Schema.optional(Schema.NonEmptyString),
  OPERATOR_TOKEN: Schema.optional(Schema.NonEmptyString),
  SESSION_SECRET: Schema.optional(Schema.NonEmptyString),
  CRON_SECRET: Schema.optional(Schema.NonEmptyString),
  MAILER: Schema.optionalWith(Schema.Literal('none', 'console'), {
    default: () => 'none' as const,
  }),
})

/** `ENGINE_SECRET_<SLUG>` with the slug upper-cased and dashes as underscores, e.g. `ENGINE_SECRET_MY_ENGINE`. */
export const engineSecretVar = (slug: string) =>
  `ENGINE_SECRET_${slug.toUpperCase().replaceAll('-', '_')}`

/**
 * Production wiring, memoised per isolate (ADR-0012). Platform bindings (D1,
 * secrets) arrive via `event.platform`; the platform tickets swap the Db and
 * provider layers per environment. Until the provider tickets land, the
 * DesignSource and PSP are the in-memory stand-ins.
 */
let cached: Promise<WebHandler> | undefined

/** Decided when the bundle was built (vite.config.ts `define`), never by the runtime environment. */
const isE2E = () => __PRESSLINE_E2E__
/** The config this process runs with: the Operator's file, or the e2e seed's when Playwright drives it. */
const effectiveConfig = () => (isE2E() ? { ...rawConfig, ...e2eConfig } : rawConfig)

/** For page loaders that need config outside the Effect runtime (branding). */
export const currentConfig = () => effectiveConfig()

/** Demo Mode makes the Operator View public (reads only); the page guard steps aside. */
export const isDemo = (): boolean => effectiveConfig().demo ?? false

/** The cookie-signing secret, for the SvelteKit guard (same source as the runtime). */
export const operatorSessionSecret = (platform: App.Platform | undefined): string => {
  const rawEnv = (platform?.env ?? process.env) as Record<string, unknown>
  const s = rawEnv['SESSION_SECRET'] ?? rawEnv['OPERATOR_TOKEN']
  return typeof s === 'string' ? s : ''
}

export const getWebHandler = (platform: App.Platform | undefined): Promise<WebHandler> => {
  if (cached) return cached
  cached = buildWebHandler(platform)
  return cached
}

export type RuntimeEnv = typeof Env.Type

/** Every environment variable this app reads, taken from the schema so a test cannot drift from it. */
export const ENV_KEYS = Object.keys(Env.fields) as ReadonlyArray<keyof RuntimeEnv>

/**
 * Env → layer options, as pure functions so the wiring can be tested without
 * booting the app. `STRIPE_WEBHOOK_SECRET` once sat in the schema and reached
 * no layer, so every webhook was rejected on a correctly configured instance
 * (#75); `tests/runtime-wiring.test.ts` now fails if any declared secret stops
 * reaching the layer that needs it.
 */
export const printfulOptions = (env: RuntimeEnv) =>
  env.PRINTFUL_TOKEN
    ? {
        token: env.PRINTFUL_TOKEN,
        ...(env.PRINTFUL_WEBHOOK_SECRET ? { webhookSecret: env.PRINTFUL_WEBHOOK_SECRET } : {}),
        ...(env.PRINTFUL_WEBHOOK_PUBLIC_KEY
          ? { webhookPublicKey: env.PRINTFUL_WEBHOOK_PUBLIC_KEY }
          : {}),
      }
    : undefined

export const stripeOptions = (env: RuntimeEnv) =>
  env.STRIPE_SECRET_KEY
    ? {
        secretKey: env.STRIPE_SECRET_KEY,
        ...(env.STRIPE_WEBHOOK_SECRET ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}),
      }
    : undefined

export const resendOptions = (
  env: RuntimeEnv,
  email: { readonly from?: string | undefined; readonly replyTo?: string | undefined } | undefined,
) =>
  env.RESEND_API_KEY && email?.from
    ? {
        apiKey: env.RESEND_API_KEY,
        from: email.from,
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      }
    : undefined

export const operatorSecrets = (env: RuntimeEnv) => ({
  // Without OPERATOR_TOKEN the operator API refuses everything (an empty token never matches).
  token: env.OPERATOR_TOKEN ?? '',
  // SESSION_SECRET falls back to the operator token, so rotating the token also ends sessions.
  sessionSecret: env.SESSION_SECRET ?? env.OPERATOR_TOKEN ?? '',
  ...(env.CRON_SECRET ? { cronSecret: env.CRON_SECRET } : {}),
})

export const mailerKind = (env: RuntimeEnv) =>
  env.RESEND_API_KEY ? 'resend' : env.MAILER === 'console' ? 'console' : 'none'

const buildWebHandler = async (platform: App.Platform | undefined): Promise<WebHandler> => {
  const rawEnv = (platform?.env ?? process.env) as Record<string, unknown>
  const env = Schema.decodeUnknownSync(Env)(rawEnv, { onExcessProperty: 'ignore' })
  const DbLive = await layerDbForPlatform(env, platform)
  assertDemoSafe(rawConfig.demo ?? false, env.STRIPE_SECRET_KEY)
  // Engines without a secret configured are wired with an empty one: the
  // startup health check then reports them as disabled rather than failing boot.
  const engines = rawConfig.engines.map((e) => {
    const secret = rawEnv[engineSecretVar(e.slug)]
    return { slug: e.slug, baseUrl: e.baseUrl, secret: typeof secret === 'string' ? secret : '' }
  })

  const printful = printfulOptions(env)
  const RealProvider = printful ? layerPrintful(printful) : layerFulfillmentProviderMemory
  // Demo Mode: drafts are real, confirmation is a cancellation (ticket #18).
  const FulfillmentProviderLive = rawConfig.demo
    ? demoFulfillmentProvider(RealProvider)
    : RealProvider
  const stripe = stripeOptions(env)
  const PspLive = stripe ? layerStripe(stripe) : layerPspMemory
  // Resend when a key and a sender are configured; `console` for local runs; else `none`.
  if (
    (env.RESEND_API_KEY && !rawConfig.email?.from) ||
    (!env.RESEND_API_KEY && rawConfig.email?.from)
  ) {
    throw new Error(
      'Mailer misconfigured: RESEND_API_KEY and pressline.config.ts email.from must be set together',
    )
  }
  const resend = resendOptions(env, rawConfig.email)
  const MailerLive = resend
    ? layerResend(resend)
    : env.MAILER === 'console'
      ? layerMailerConsole
      : layerMailerNone
  const OperatorSecretsLive = Layer.succeed(OperatorSecrets, operatorSecrets(env))

  const InstanceFactsLive = Layer.succeed(InstanceFacts, {
    mailer: mailerKind(env),
    secrets: {
      printful: !!env.PRINTFUL_TOKEN,
      stripe: !!env.STRIPE_SECRET_KEY,
      stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
      printfulWebhook: !!env.PRINTFUL_WEBHOOK_SECRET,
      resend: !!env.RESEND_API_KEY,
      sessionSecret: !!env.SESSION_SECRET,
      cron: !!env.CRON_SECRET,
    },
  })

  if (isE2E()) {
    // Only reachable in a Playwright build: the seed module is not in any other bundle.
    const { e2eServices } = await import('./e2e/seed')
    return makeWebHandler(
      Layer.mergeAll(
        Config.layer(effectiveConfig()),
        OperatorSecretsLive,
        InstanceFactsLive,
        DbLive,
        e2eServices,
      ),
    )
  }

  const services = Layer.mergeAll(
    Config.layer(rawConfig),
    OperatorSecretsLive,
    InstanceFactsLive,
    DbLive,
    layerDesignSourceHttp(engines),
    FulfillmentProviderLive,
    PspLive,
    MailerLive,
  ).pipe(
    // One outbound HTTP client for the Engine client, Printful and Printfile validation.
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.tapErrorCause((c) => Effect.logError('boot failed', c)),
  )

  return makeWebHandler(services)
}
