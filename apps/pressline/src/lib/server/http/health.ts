import { HttpApiBuilder } from '@effect/platform';
import { Effect } from 'effect';
import { Config } from '../config/schema';
import { schemaVersion } from '../db/migrate';
import { PROTOCOL_VERSION } from '@pressline/contract';
import { Engines } from '../design/engines';
import { PresslineApi } from './api';

export const HealthLive = HttpApiBuilder.group(PresslineApi, 'health', (handlers) =>
  handlers.handle('health', () =>
    Effect.gen(function* () {
      const config = yield* Config;
      const version = yield* schemaVersion.pipe(Effect.orDie);
      const engines = yield* Effect.flatMap(Engines, (e) => e.all);
      return {
        ok: true as const,
        protocolVersion: PROTOCOL_VERSION,
        schemaVersion: version,
        demo: config.demo,
        config: {
          name: config.name,
          currency: config.currency,
          offers: config.catalogue.offers.length,
        },
        engines: engines.map((e) => ({
          slug: e.slug,
          enabled: e.enabled,
          ...(e.protocolVersion !== undefined ? { protocolVersion: e.protocolVersion } : {}),
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
        })),
      };
    }),
  ),
);
