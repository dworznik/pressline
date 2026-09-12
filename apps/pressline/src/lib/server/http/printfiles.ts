import { HttpApiBuilder } from '@effect/platform'
import { ensurePrintfile } from '../printfile/ensure'
import { PresslineApi } from './api'
import { toApiError } from './errors'

/** Ensure-Printfile endpoints (ticket #6): POST waits within the bound, GET only reports. */
export const PrintfilesLive = HttpApiBuilder.group(PresslineApi, 'printfiles', (handlers) =>
  handlers
    .handle('ensure', ({ path, payload }) =>
      toApiError(
        path.designId,
        ensurePrintfile({ engine: path.engine, designId: path.designId, ...payload, wait: true }),
      ),
    )
    .handle('status', ({ path, urlParams }) =>
      toApiError(
        path.designId,
        ensurePrintfile({
          engine: path.engine,
          designId: path.designId,
          ...urlParams,
          wait: false,
        }),
      ),
    ),
)
