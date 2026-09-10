import { HttpApiBuilder } from '@effect/platform';
import { Effect } from 'effect';
import { Config } from '../config/schema';
import { schemaVersion } from '../db/migrate';
import { PresslineApi, PROTOCOL_VERSION } from './api';

export const HealthLive = HttpApiBuilder.group(PresslineApi, 'health', (handlers) =>
  handlers.handle('health', () =>
    Effect.gen(function* () {
      const config = yield* Config;
      const version = yield* schemaVersion.pipe(Effect.orDie);
      return {
        ok: true as const,
        protocolVersion: PROTOCOL_VERSION,
        schemaVersion: version,
        demo: config.demo,
        config: {
          name: config.name,
          currency: config.currency,
          engines: config.engines.map((e) => e.slug),
          offers: config.catalogue.offers.length,
        },
      };
    }),
  ),
);
