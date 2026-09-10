import { HttpApiBuilder } from '@effect/platform';
import { Clock, Context, Effect } from 'effect';
import { OperatorPrincipal, OperatorSecrets, Unauthorized } from '../operator/auth';
import { instanceHealth, orderDetail, orderList } from '../operator/read';
import { SESSION_TTL_MS, signSession } from '../operator/session';
import { PresslineApi } from './api';

/** Which Mailer is wired, for the health page (set by the runtime; tests get "memory"). */
export class MailerKind extends Context.Tag('pressline/MailerKind')<MailerKind, string>() {}

export const OperatorLive = HttpApiBuilder.group(PresslineApi, 'operator', (handlers) =>
  handlers
    .handle('session', () =>
      Effect.gen(function* () {
        // Only the bearer token may mint a session; a cookie cannot renew itself.
        const principal = yield* OperatorPrincipal;
        if (principal.via !== 'bearer')
          return yield* new Unauthorized({
            message: 'a session is issued against the operator token',
          });
        const secrets = yield* OperatorSecrets;
        const expiresAt = (yield* Clock.currentTimeMillis) + SESSION_TTL_MS;
        return { cookie: yield* signSession(secrets.sessionSecret, expiresAt), expiresAt };
      }),
    )
    .handle('health', () => Effect.flatMap(MailerKind, (kind) => instanceHealth(kind)))
    .handle('orders', ({ urlParams }) => orderList(urlParams))
    .handle('order', ({ path }) => orderDetail(path.id)),
);
