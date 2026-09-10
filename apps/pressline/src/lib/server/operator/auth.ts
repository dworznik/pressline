import { HttpApiMiddleware, HttpApiSecurity } from '@effect/platform';
import { Clock, Context, Effect, Layer, Redacted, Schema } from 'effect';
import { timingSafeEqual } from '../security';
import { SESSION_COOKIE, verifySession } from './session';

/** The Operator's single credential and the cookie-signing secret (from the platform env). */
export interface OperatorSecretsValue {
  readonly token: string;
  readonly sessionSecret: string;
}
export class OperatorSecrets extends Context.Tag('pressline/OperatorSecrets')<
  OperatorSecrets,
  OperatorSecretsValue
>() {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String,
}) {}

/** Who is calling: the CLI (bearer) or the Operator View (session cookie). */
export class OperatorPrincipal extends Context.Tag('pressline/OperatorPrincipal')<
  OperatorPrincipal,
  { readonly via: 'bearer' | 'cookie' }
>() {}

/**
 * `/api/operator/*` accepts the OPERATOR_TOKEN as a bearer (CLI) or the
 * signed session cookie (Operator View). Unauthenticated calls are 401.
 */
export class OperatorAuth extends HttpApiMiddleware.Tag<OperatorAuth>()('pressline/OperatorAuth', {
  failure: Unauthorized,
  provides: OperatorPrincipal,
  security: {
    bearer: HttpApiSecurity.bearer,
    cookie: HttpApiSecurity.apiKey({ key: SESSION_COOKIE, in: 'cookie' }),
  },
}) {}

export const OperatorAuthLive = Layer.effect(
  OperatorAuth,
  Effect.gen(function* () {
    const secrets = yield* OperatorSecrets;
    return {
      bearer: (token: Redacted.Redacted<string>) =>
        secrets.token && timingSafeEqual(Redacted.value(token), secrets.token)
          ? Effect.succeed({ via: 'bearer' as const })
          : Effect.fail(new Unauthorized({ message: 'bad operator token' })),
      cookie: (value: Redacted.Redacted<string>) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const ok = yield* verifySession(secrets.sessionSecret, Redacted.value(value), now);
          if (!ok) return yield* new Unauthorized({ message: 'no valid operator session' });
          return { via: 'cookie' as const };
        }),
    };
  }),
);
