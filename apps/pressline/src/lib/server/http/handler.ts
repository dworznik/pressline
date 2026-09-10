import { HttpApiBuilder, HttpServer } from '@effect/platform';
import { Layer } from 'effect';
import type { Config } from '../config/schema';
import type { Db } from '../db/db';
import type { DesignSource } from '../services/design-source';
import type { FulfilmentProvider } from '../services/fulfilment-provider';
import type { Mailer } from '../services/mailer';
import type { Psp } from '../services/psp';
import { PresslineApi } from './api';
import { HealthLive } from './health';

/** Everything the HTTP layer needs from the outside world. */
export type Services = Config | Db | DesignSource | FulfilmentProvider | Psp | Mailer;

/**
 * Build the web-standard `(Request) => Promise<Response>` for the whole API
 * from a layer of services. The same function serves production (hooks.server)
 * and the HTTP-seam test harness with in-memory services.
 */
export const makeWebHandler = <E>(services: Layer.Layer<Services, E>) =>
  HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.api(PresslineApi).pipe(Layer.provide(HealthLive)),
      HttpServer.layerContext,
    ).pipe(Layer.provide(services)),
  );

export type WebHandler = ReturnType<typeof makeWebHandler>;

/** Paths SvelteKit hands to the Effect handler. */
export const isApiPath = (pathname: string) =>
  pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/webhooks/');
