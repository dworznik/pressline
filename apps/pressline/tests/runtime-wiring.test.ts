import { describe, expect, it } from 'vitest'
import {
  ENV_KEYS,
  engineSecretVar,
  mailerKind,
  operatorSecrets,
  printfulOptions,
  resendOptions,
  stripeOptions,
  type RuntimeEnv,
} from '$lib/server/runtime'

/**
 * The wiring seam (#85). `STRIPE_WEBHOOK_SECRET` was declared in the env schema
 * and passed to no layer, so a correctly configured instance rejected every
 * Stripe webhook and paid Orders never reached Printful (#75). Nothing caught
 * it: the HTTP-surface tests run on in-memory layers that never read env at
 * all. These tests read the env schema itself, so a variable added later and
 * left unwired fails here rather than in production.
 */

/** Every secret set to a value that identifies it, so we can find where it landed. */
const sentinel = (key: string) => `sentinel:${key}`
const fullEnv = (): RuntimeEnv =>
  Object.fromEntries([
    ...ENV_KEYS.filter((k) => k !== 'MAILER').map((k) => [k, sentinel(String(k))]),
    ['MAILER', 'none'],
  ]) as RuntimeEnv

/** Every string anywhere in a built options object. */
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(value).flatMap(strings)
      : []

/**
 * Where each variable is meant to end up. `DATABASE_PATH` and the Turso pair go
 * to the Db layer, which is chosen per platform and takes the whole env; they
 * are covered by `migrate.test.ts` and the platform builds, not here.
 */
const DB_KEYS = ['DATABASE_PATH', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']
const NOT_A_SECRET = ['MAILER']

describe('runtime wiring: env reaches its layer', () => {
  it('passes every Printful secret to the provider layer', () => {
    const env = fullEnv()
    expect(printfulOptions(env)).toEqual({
      token: sentinel('PRINTFUL_TOKEN'),
      webhookSecret: sentinel('PRINTFUL_WEBHOOK_SECRET'),
      webhookPublicKey: sentinel('PRINTFUL_WEBHOOK_PUBLIC_KEY'),
    })
    // No token: the memory provider, and no half-built options.
    expect(printfulOptions({ ...env, PRINTFUL_TOKEN: undefined })).toBeUndefined()
  })

  it('passes the Stripe key and webhook secret to the PSP layer', () => {
    const env = fullEnv()
    expect(stripeOptions(env)).toEqual({
      secretKey: sentinel('STRIPE_SECRET_KEY'),
      webhookSecret: sentinel('STRIPE_WEBHOOK_SECRET'),
    })
    expect(stripeOptions({ ...env, STRIPE_SECRET_KEY: undefined })).toBeUndefined()
    // The #75 shape exactly: a key but no webhook secret must not silently drop the field.
    expect(stripeOptions({ ...env, STRIPE_WEBHOOK_SECRET: undefined })).toEqual({
      secretKey: sentinel('STRIPE_SECRET_KEY'),
    })
  })

  it('passes the Resend key with the sender from the config, or nothing', () => {
    const env = fullEnv()
    expect(resendOptions(env, { from: 'shop@example.test', replyTo: 'hi@example.test' })).toEqual({
      apiKey: sentinel('RESEND_API_KEY'),
      from: 'shop@example.test',
      replyTo: 'hi@example.test',
    })
    expect(resendOptions(env, undefined)).toBeUndefined()
    expect(
      resendOptions({ ...env, RESEND_API_KEY: undefined }, { from: 'a@b.test' }),
    ).toBeUndefined()
  })

  it('gives the operator token, the session secret and the cron secret their meanings', () => {
    const env = fullEnv()
    expect(operatorSecrets(env)).toEqual({
      token: sentinel('OPERATOR_TOKEN'),
      sessionSecret: sentinel('SESSION_SECRET'),
      cronSecret: sentinel('CRON_SECRET'),
    })
    // Documented fallback: no SESSION_SECRET means the operator token signs sessions,
    // so rotating the token also ends every session.
    expect(operatorSecrets({ ...env, SESSION_SECRET: undefined }).sessionSecret).toBe(
      sentinel('OPERATOR_TOKEN'),
    )
    // Nothing configured: an empty token, which never matches a presented one.
    expect(operatorSecrets({ MAILER: 'none' } as RuntimeEnv)).toEqual({
      token: '',
      sessionSecret: '',
    })
  })

  it('reports the mailer the config and env actually select', () => {
    expect(mailerKind(fullEnv())).toBe('resend')
    expect(mailerKind({ MAILER: 'console' } as RuntimeEnv)).toBe('console')
    expect(mailerKind({ MAILER: 'none' } as RuntimeEnv)).toBe('none')
  })

  it('leaves no declared variable unwired', () => {
    const env = fullEnv()
    const landed = new Set([
      ...strings(printfulOptions(env)),
      ...strings(stripeOptions(env)),
      ...strings(resendOptions(env, { from: 'shop@example.test' })),
      ...strings(operatorSecrets(env)),
    ])
    const unwired = ENV_KEYS.map(String)
      .filter((k) => !DB_KEYS.includes(k) && !NOT_A_SECRET.includes(k))
      .filter((k) => !landed.has(sentinel(k)))
    expect(unwired, 'declared in the env schema but passed to no layer').toEqual([])
  })

  it('names the per-Engine secret variable the deploy docs promise', () => {
    expect(engineSecretVar('sample')).toBe('ENGINE_SECRET_SAMPLE')
    expect(engineSecretVar('my-engine')).toBe('ENGINE_SECRET_MY_ENGINE')
  })
})
