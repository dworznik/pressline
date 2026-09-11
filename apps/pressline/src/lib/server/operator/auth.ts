import { HttpApiMiddleware, HttpServerRequest } from '@effect/platform';
import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { Config } from '../config/schema';
import { timingSafeEqual } from '../security';
import { SESSION_COOKIE, verifySession } from './session';

/** The Operator's single credential and the cookie-signing secret (from the platform env). */
export interface OperatorSecretsValue {
  readonly token: string;
  readonly sessionSecret: string;
  /** Bearer for the scheduled reconciliation route (Vercel Cron); unset disables the route. */
  readonly cronSecret?: string;
}
export class OperatorSecrets extends Context.Tag('pressline/OperatorSecrets')<
  OperatorSecrets,
  OperatorSecretsValue
>() {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String,
}) {}

/** Who is calling: the CLI (bearer), the Operator View (session cookie), or the public in Demo Mode (reads only). */
export class OperatorPrincipal extends Context.Tag('pressline/OperatorPrincipal')<
  OperatorPrincipal,
  { readonly via: 'bearer' | 'cookie' | 'demo' }
>() {}

/**
 * `/api/operator/*` accepts the OPERATOR_TOKEN as a bearer (CLI) or the
 * signed session cookie (Operator View). Unauthenticated calls are 401,
 * except reads in Demo Mode (ticket #18): anyone may watch, nobody may act.
 */
export class OperatorAuth extends HttpApiMiddleware.Tag<OperatorAuth>()('pressline/OperatorAuth', {
  failure: Unauthorized,
  provides: OperatorPrincipal,
}) {}

export const OperatorAuthLive = Layer.effect(
  OperatorAuth,
  Effect.gen(function* () {
    const secrets = yield* OperatorSecrets;
    const config = yield* Config;
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const bearer = /^Bearer\s+(.+)$/i.exec(request.headers['authorization'] ?? '')?.[1];
      if (bearer !== undefined) {
        if (secrets.token && timingSafeEqual(bearer, secrets.token))
          return { via: 'bearer' as const };
        return yield* new Unauthorized({ message: 'bad operator token' });
      }
      const cookie = request.cookies[SESSION_COOKIE];
      if (cookie !== undefined) {
        const now = yield* Clock.currentTimeMillis;
        const ok = yield* verifySession(secrets.sessionSecret, cookie, now);
        if (!ok) return yield* new Unauthorized({ message: 'no valid operator session' });
        return { via: 'cookie' as const };
      }
      if (config.demo && (request.method === 'GET' || request.method === 'HEAD')) {
        return { via: 'demo' as const };
      }
      return yield* new Unauthorized({ message: 'operator token or session required' });
    });
  }),
);
