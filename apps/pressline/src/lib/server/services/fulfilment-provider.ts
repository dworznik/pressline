import { Context, Effect, Layer, Schema } from 'effect';

/**
 * Fulfilment Provider (CONTEXT.md): prints and ships. Printful v2 is the only
 * shipped implementation (ADR-0007), arriving with ticket #4 (catalog) and
 * #10 (orders). Method set grows per ticket.
 */
export class ProviderError extends Schema.TaggedError<ProviderError>()('ProviderError', {
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export interface FulfilmentProviderService {
  readonly health: () => Effect.Effect<void, ProviderError>;
}

export class FulfilmentProvider extends Context.Tag('pressline/FulfilmentProvider')<
  FulfilmentProvider,
  FulfilmentProviderService
>() {}

export const layerFulfilmentProviderMemory = Layer.succeed(FulfilmentProvider, {
  health: () => Effect.void,
});
