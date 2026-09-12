import { HttpApiBuilder, HttpServer, type HttpClient } from '@effect/platform'
import { Layer } from 'effect'
import type { Config } from '../config/schema'
import type { Db } from '../db/db'
import type { DesignSource } from '../services/design-source'
import type { FulfillmentProvider } from '../services/fulfillment-provider'
import type { Mailer } from '../services/mailer'
import type { Psp } from '../services/psp'
import { PresslineApi } from './api'
import { EnginesLive } from '../design/engines'
import { CatalogLive } from './catalog'
import { DesignsLive } from './designs'
import { HealthLive } from './health'
import { PrintfilesLive } from './printfiles'
import { OperatorAuthLive, type OperatorSecrets } from '../operator/auth'
import type { InstanceFacts } from '../operator/instance'
import { CronLive, OperatorLive } from './operator'
import { OrdersLive } from './orders'
import { QuotesLive } from './quotes'
import { WebhooksLive } from './webhooks'

/** Everything the HTTP layer needs from the outside world. */
export type Services =
  | Config
  | Db
  | DesignSource
  | FulfillmentProvider
  | Psp
  | Mailer
  | HttpClient.HttpClient
  | OperatorSecrets
  | InstanceFacts

/**
 * Build the web-standard `(Request) => Promise<Response>` for the whole API
 * from a layer of services. The same function serves production (hooks.server)
 * and the HTTP-seam test harness with in-memory services.
 */
export const makeWebHandler = <E>(services: Layer.Layer<Services, E>) => {
  const api = HttpApiBuilder.api(PresslineApi).pipe(
    Layer.provide([
      HealthLive,
      CatalogLive,
      DesignsLive,
      PrintfilesLive,
      QuotesLive,
      OrdersLive,
      WebhooksLive,
      OperatorLive,
      CronLive,
    ]),
    Layer.provide([EnginesLive, OperatorAuthLive]),
  )
  return HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      api,
      // The API describes itself (ticket #26); the docs site publishes a build-time copy.
      HttpApiBuilder.middlewareOpenApi({ path: '/api/openapi.json' }).pipe(Layer.provide(api)),
      HttpServer.layerContext,
    ).pipe(Layer.provide(services)),
  )
}

export type WebHandler = ReturnType<typeof makeWebHandler>

/** Paths SvelteKit hands to the Effect handler. */
export const isApiPath = (pathname: string) =>
  pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/webhooks/')
