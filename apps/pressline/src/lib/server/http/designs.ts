import { HttpApiBuilder } from '@effect/platform';
import { loadDesign } from '../design/design';
import { PresslineApi } from './api';
import { toApiError } from './errors';

/** `GET /api/designs/{engine}/{designId}`: the Storefront design page's data. */
export const DesignsLive = HttpApiBuilder.group(PresslineApi, 'designs', (handlers) =>
  handlers.handle('design', ({ path }) =>
    toApiError(path.designId, loadDesign(path.engine, path.designId)),
  ),
);
