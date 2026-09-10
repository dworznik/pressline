import { PROTOCOL_VERSION } from '@pressline/contract';
import { Clock, Context, Effect, Layer, Ref, Schema } from 'effect';
import { Config } from '../config/schema';
import { DesignSource } from '../services/design-source';

/**
 * What Pressline knows about each configured Engine from its health check.
 * A protocol mismatch disables the Engine for good; an unreachable Engine is
 * disabled but `transient`, and is re-checked (at most every
 * `RECHECK_AFTER_MS`) when a Storefront request needs it, so a cold start
 * while the Engine is briefly down does not disable it for the isolate's life.
 */
export const EngineStatus = Schema.Struct({
  slug: Schema.String,
  enabled: Schema.Boolean,
  protocolVersion: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  /** Worth re-checking later (unreachable), as opposed to a protocol mismatch. */
  transient: Schema.optional(Schema.Boolean),
});
export type EngineStatus = typeof EngineStatus.Type;

export const RECHECK_AFTER_MS = 30_000;

export interface EnginesService {
  readonly all: Effect.Effect<ReadonlyArray<EngineStatus>>;
  readonly get: (slug: string) => Effect.Effect<EngineStatus | undefined>;
  /** Re-run every health check now (also used by `doctor` and Reconciliation). */
  readonly refresh: Effect.Effect<ReadonlyArray<EngineStatus>>;
  /** Re-check one transiently disabled Engine if enough time has passed; returns its current status. */
  readonly recheck: (slug: string) => Effect.Effect<EngineStatus | undefined>;
}

export class Engines extends Context.Tag('pressline/Engines')<Engines, EnginesService>() {}

const check = (slug: string) =>
  Effect.gen(function* () {
    const source = yield* DesignSource;
    return yield* source.health(slug).pipe(
      Effect.map(({ protocolVersion }): EngineStatus =>
        protocolVersion === PROTOCOL_VERSION
          ? { slug, enabled: true, protocolVersion }
          : {
              slug,
              enabled: false,
              protocolVersion,
              reason: `protocol version ${protocolVersion} (Pressline speaks ${PROTOCOL_VERSION})`,
            },
      ),
      Effect.catchAll((e) =>
        Effect.succeed<EngineStatus>({
          slug,
          enabled: false,
          reason: e.message,
          transient: e._tag === 'DesignSourceError' && e.retryable,
        }),
      ),
    );
  });

export const EnginesLive = Layer.effect(
  Engines,
  Effect.gen(function* () {
    const config = yield* Config;
    const source = yield* DesignSource;
    const runChecks = Effect.forEach(config.engines, (e) => check(e.slug)).pipe(
      Effect.provideService(DesignSource, source),
    );
    const statuses = yield* Ref.make<ReadonlyArray<EngineStatus>>(yield* runChecks);
    const checkedAt = yield* Ref.make(new Map<string, number>());
    const get = (slug: string) =>
      Ref.get(statuses).pipe(Effect.map((all) => all.find((s) => s.slug === slug)));
    return {
      all: Ref.get(statuses),
      get,
      refresh: runChecks.pipe(Effect.tap((next) => Ref.set(statuses, next))),
      recheck: (slug) =>
        Effect.gen(function* () {
          const current = yield* get(slug);
          if (!current || current.enabled || !current.transient) return current;
          const now = yield* Clock.currentTimeMillis;
          const last = (yield* Ref.get(checkedAt)).get(slug) ?? 0;
          if (now - last < RECHECK_AFTER_MS) return current;
          yield* Ref.update(checkedAt, (m) => new Map(m).set(slug, now));
          const next = yield* check(slug).pipe(Effect.provideService(DesignSource, source));
          yield* Ref.update(statuses, (all) => all.map((s) => (s.slug === slug ? next : s)));
          return next;
        }),
    } satisfies EnginesService;
  }),
);
