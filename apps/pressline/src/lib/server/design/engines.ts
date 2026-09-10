import { PROTOCOL_VERSION } from '@pressline/contract';
import { Context, Effect, Layer, Ref } from 'effect';
import { Config } from '../config/schema';
import { DesignSource } from '../services/design-source';

/**
 * What Pressline knows about each configured Engine after the startup health
 * check. A protocol mismatch or an unreachable Engine disables it: its
 * Storefront pages answer 503 and `/api/health` shows why (ticket #5).
 */
export interface EngineStatus {
  readonly slug: string;
  readonly enabled: boolean;
  readonly protocolVersion?: string;
  readonly reason?: string;
}

export interface EnginesService {
  readonly all: Effect.Effect<ReadonlyArray<EngineStatus>>;
  readonly get: (slug: string) => Effect.Effect<EngineStatus | undefined>;
  /** Re-run the health checks (used by `doctor` and Reconciliation later). */
  readonly refresh: Effect.Effect<ReadonlyArray<EngineStatus>>;
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
        Effect.succeed<EngineStatus>({ slug, enabled: false, reason: e.message }),
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
    return {
      all: Ref.get(statuses),
      get: (slug) => Ref.get(statuses).pipe(Effect.map((all) => all.find((s) => s.slug === slug))),
      refresh: runChecks.pipe(Effect.tap((next) => Ref.set(statuses, next))),
    } satisfies EnginesService;
  }),
);
