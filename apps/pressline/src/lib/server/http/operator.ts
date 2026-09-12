import { HttpApiBuilder } from '@effect/platform'
import { Clock, Effect } from 'effect'
import { OperatorPrincipal, OperatorSecrets, Unauthorized } from '../operator/auth'
import { cancel, createManualOrder, fixAddress, purge, resubmit } from '../operator/actions'
import { InstanceFacts } from '../operator/instance'
import { instanceHealth, orderDetail, orderList } from '../operator/read'
import { catalogCheck, catalogSearch, printfileCheck, webhooksRegister } from '../operator/tools'
import { CatalogUnavailable } from './api'
import { SESSION_TTL_MS, signSession } from '../operator/session'
import { latestReport, runReconciliation } from '../reconciliation/run'
import { timingSafeEqual } from '../security'
import { PresslineApi } from './api'

export const OperatorLive = HttpApiBuilder.group(PresslineApi, 'operator', (handlers) =>
  handlers
    .handle('session', () =>
      Effect.gen(function* () {
        // Only the bearer token may mint a session; a cookie cannot renew itself.
        const principal = yield* OperatorPrincipal
        if (principal.via !== 'bearer')
          return yield* new Unauthorized({
            message: 'a session is issued against the operator token',
          })
        const secrets = yield* OperatorSecrets
        const expiresAt = (yield* Clock.currentTimeMillis) + SESSION_TTL_MS
        return { cookie: yield* signSession(secrets.sessionSecret, expiresAt), expiresAt }
      }),
    )
    .handle('health', () => Effect.flatMap(InstanceFacts, instanceHealth))
    .handle('orders', ({ urlParams }) => orderList(urlParams))
    .handle('order', ({ path }) => orderDetail(path.id))
    .handle('reconcile', ({ urlParams }) =>
      runReconciliation('operator', { dryRun: urlParams.dryRun === 'true' }),
    )
    .handle('catalogSearch', ({ urlParams }) =>
      catalogSearch(urlParams.q).pipe(
        Effect.mapError((e) => new CatalogUnavailable({ message: e.message })),
      ),
    )
    .handle('catalogCheck', () => catalogCheck)
    .handle('createOrder', ({ payload }) => createManualOrder(payload))
    .handle('purgeOrders', ({ payload }) => purge(payload))
    .handle('resubmitOrder', ({ path }) => resubmit(path.id))
    .handle('fixOrderAddress', ({ path, payload }) => fixAddress(path.id, payload.recipient))
    .handle('cancelOrder', ({ path }) => cancel(path.id))
    .handle('webhooksRegister', ({ payload }) => webhooksRegister(payload.publicUrl))
    .handle('printfileCheck', ({ payload }) => printfileCheck(payload))
    .handle('reconciliation', () => latestReport.pipe(Effect.map((r) => r ?? null))),
)

/** `GET /api/cron/reconcile` with `Authorization: Bearer <CRON_SECRET>`: exactly what Vercel Cron sends. */
export const CronLive = HttpApiBuilder.group(PresslineApi, 'cron', (handlers) =>
  handlers.handle('reconcile', ({ headers }) =>
    Effect.gen(function* () {
      const secrets = yield* OperatorSecrets
      const given = headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
      if (!secrets.cronSecret || !timingSafeEqual(given, secrets.cronSecret)) {
        return yield* new Unauthorized({ message: 'bad cron secret' })
      }
      return yield* runReconciliation('cron')
    }),
  ),
)
