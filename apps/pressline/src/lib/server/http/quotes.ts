import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'
import { findQuote, makeQuote, toPublicQuote } from '../quote/quote'
import { PresslineApi } from './api'
import { toApiError } from './errors'

/** `GET /api/quote`: a locked Quote for (Design, Offer variant, country). `GET /api/quotes/{id}` reads one back. */
export const QuotesLive = HttpApiBuilder.group(PresslineApi, 'quotes', (handlers) =>
  handlers
    .handle('quote', ({ urlParams }) =>
      toApiError(urlParams.designId, makeQuote(urlParams).pipe(Effect.map(toPublicQuote))),
    )
    .handle('quoteById', ({ path }) => findQuote(path.id).pipe(Effect.map(toPublicQuote))),
)
