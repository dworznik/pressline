import { Context, Effect, Layer, Schema } from 'effect';

/**
 * DesignSource (CONTEXT.md): the contract an Engine implements. The shipped
 * implementation is an HTTP client (ticket #5); the full method set and its
 * Schemas come from @pressline/contract (ticket #3). Declared here so the
 * runtime can be wired and tested with an in-memory Engine from day one.
 */
export class DesignSourceError extends Schema.TaggedError<DesignSourceError>()(
  'DesignSourceError',
  { engine: Schema.String, message: Schema.String },
) {}

export interface DesignSourceService {
  /** `GET /health` on the Engine; used at startup and by `doctor`. */
  readonly health: (
    engineSlug: string,
  ) => Effect.Effect<{ readonly protocolVersion: string }, DesignSourceError>;
}

export class DesignSource extends Context.Tag('pressline/DesignSource')<
  DesignSource,
  DesignSourceService
>() {}

/** In-memory Engine for tests: every configured slug reports the given version. */
export const layerDesignSourceMemory = (options: { protocolVersion: string }) =>
  Layer.succeed(DesignSource, {
    health: () => Effect.succeed({ protocolVersion: options.protocolVersion }),
  });
