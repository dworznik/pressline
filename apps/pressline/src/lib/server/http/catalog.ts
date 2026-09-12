import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'
import { resolveCatalog } from '../catalog/catalog'
import { CatalogUnavailable, PresslineApi } from './api'

/** `GET /api/offers`: public, no credentials, so Engines can pre-render. */
export const CatalogLive = HttpApiBuilder.group(PresslineApi, 'catalog', (handlers) =>
  handlers.handle('offers', () =>
    resolveCatalog.pipe(
      Effect.catchTags({
        CatalogError: (e) =>
          new CatalogUnavailable({ message: `Offer "${e.offer}": ${e.message}`, offer: e.offer }),
        FulfillmentProviderError: (e) => new CatalogUnavailable({ message: e.message }),
      }),
    ),
  ),
)
