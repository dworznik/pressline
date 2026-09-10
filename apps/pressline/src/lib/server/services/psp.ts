import { Context, Effect, Layer, Schema } from 'effect';

/**
 * PSP (CONTEXT.md): takes the Customer's money. Stripe Checkout is the only
 * shipped implementation, arriving with ticket #8. Method set grows per ticket.
 */
export class PspError extends Schema.TaggedError<PspError>()('PspError', {
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export interface PspService {
  readonly health: () => Effect.Effect<void, PspError>;
}

export class Psp extends Context.Tag('pressline/Psp')<Psp, PspService>() {}

export const layerPspMemory = Layer.succeed(Psp, { health: () => Effect.void });
