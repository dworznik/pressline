import { HttpApiBuilder } from '@effect/platform';
import { DesignNotFound } from '@pressline/contract';
import { Effect } from 'effect';
import { loadDesign } from '../design/design';
import { CatalogueUnavailable, EngineError, EngineUnavailableError, PresslineApi } from './api';

/** `GET /api/designs/{engine}/{designId}`: the Storefront design page's data. */
export const DesignsLive = HttpApiBuilder.group(PresslineApi, 'designs', (handlers) =>
  handlers.handle('design', ({ path }) =>
    loadDesign(path.engine, path.designId).pipe(
      Effect.catchTags({
        // An Engine that is not configured looks, to the public, like a missing design.
        UnknownEngine: () => new DesignNotFound({ designId: path.designId }),
        EngineUnavailable: (e) =>
          new EngineUnavailableError({ engine: e.engine, reason: e.reason }),
        DesignSourceError: (e) => new EngineError({ engine: e.engine, message: e.message }),
        CatalogueError: (e) =>
          new CatalogueUnavailable({ message: `Offer "${e.offer}": ${e.message}`, offer: e.offer }),
        FulfilmentProviderError: (e) => new CatalogueUnavailable({ message: e.message }),
      }),
    ),
  ),
);
