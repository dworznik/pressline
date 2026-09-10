import type {
  DesignResponse,
  PrintfileReady,
  PrintfileRendering,
  PrintfileSpec,
} from '@pressline/contract';
import { DesignNotFound, PrintfileRejected } from '@pressline/contract';
import { Context, Schema } from 'effect';
import type { Effect } from 'effect';

/**
 * DesignSource (CONTEXT.md): the contract an Engine implements, seen from
 * Pressline. The shipped implementation is the HTTP client over
 * @pressline/contract's EngineApi; tests use the in-memory Engine.
 * Errors: the protocol's own (`DesignNotFound`, `PrintfileRejected`) pass
 * through typed; transport and decoding problems become `DesignSourceError`.
 */
export class DesignSourceError extends Schema.TaggedError<DesignSourceError>()(
  'DesignSourceError',
  { engine: Schema.String, message: Schema.String, retryable: Schema.Boolean },
) {}

/** The Engine slug is not configured on this instance. */
export class UnknownEngine extends Schema.TaggedError<UnknownEngine>()('UnknownEngine', {
  engine: Schema.String,
}) {}

export interface DesignSourceService {
  /** `GET /health` on the Engine; used at startup and by `doctor`. */
  readonly health: (
    engine: string,
  ) => Effect.Effect<{ readonly protocolVersion: string }, DesignSourceError | UnknownEngine>;
  /** `GET /designs/{id}` */
  readonly getDesign: (
    engine: string,
    designId: string,
  ) => Effect.Effect<DesignResponse, DesignNotFound | DesignSourceError | UnknownEngine>;
  /** `POST /designs/{id}/printfile`: sync-or-202 (ADR-0005). */
  readonly ensurePrintfile: (
    engine: string,
    designId: string,
    spec: PrintfileSpec,
  ) => Effect.Effect<
    PrintfileReady | PrintfileRendering,
    DesignNotFound | PrintfileRejected | DesignSourceError | UnknownEngine
  >;
}

export class DesignSource extends Context.Tag('pressline/DesignSource')<
  DesignSource,
  DesignSourceService
>() {}

export { DesignNotFound, PrintfileRejected };
