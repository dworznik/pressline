import { HttpApiBuilder } from '@effect/platform';
import { DesignNotFound } from '@pressline/contract';
import { Effect } from 'effect';
import { ensurePrintfile, type EnsureRequest } from '../printfile/ensure';
import { CatalogueUnavailable, EngineError, EngineUnavailableError, PresslineApi } from './api';

const run = (req: EnsureRequest) =>
  ensurePrintfile(req).pipe(
    Effect.catchTags({
      UnknownEngine: () => new DesignNotFound({ designId: req.designId }),
      EngineUnavailable: (e) => new EngineUnavailableError({ engine: e.engine, reason: e.reason }),
      DesignSourceError: (e) => new EngineError({ engine: e.engine, message: e.message }),
      CatalogueError: (e) =>
        new CatalogueUnavailable({ message: `Offer "${e.offer}": ${e.message}`, offer: e.offer }),
      FulfilmentProviderError: (e) => new CatalogueUnavailable({ message: e.message }),
    }),
  );

/** Ensure-Printfile endpoints (ticket #6): POST waits within the bound, GET only reports. */
export const PrintfilesLive = HttpApiBuilder.group(PresslineApi, 'printfiles', (handlers) =>
  handlers
    .handle('ensure', ({ path, payload }) =>
      run({ engine: path.engine, designId: path.designId, ...payload, wait: true }),
    )
    .handle('status', ({ path, urlParams }) =>
      run({ engine: path.engine, designId: path.designId, ...urlParams, wait: false }),
    ),
);
