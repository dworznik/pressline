import { HttpApiBuilder } from '@effect/platform';
import { Effect } from 'effect';
import { resolveCatalogue } from '../catalogue/catalogue';
import { CatalogueUnavailable, PresslineApi } from './api';

/** `GET /api/offers`: public, no credentials, so Engines can pre-render. */
export const CatalogueLive = HttpApiBuilder.group(PresslineApi, 'catalogue', (handlers) =>
  handlers.handle('offers', () =>
    resolveCatalogue.pipe(
      Effect.catchTags({
        CatalogueError: (e) =>
          new CatalogueUnavailable({ message: `Offer "${e.offer}": ${e.message}`, offer: e.offer }),
        FulfilmentProviderError: (e) => new CatalogueUnavailable({ message: e.message }),
      }),
    ),
  ),
);
