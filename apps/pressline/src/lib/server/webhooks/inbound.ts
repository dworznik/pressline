import { Clock, Effect } from 'effect';
import { Db } from '../db/db';

/**
 * Inbound Events (CONTEXT.md): every webhook delivery is recorded by the
 * provider's event ID so it is processed at most once (ADR-0007, ADR-0009).
 * A delivery whose processing failed keeps `processed_at` NULL, so the
 * provider's retry is processed again rather than ignored.
 */
export type InboundProvider = 'stripe' | 'printful';

export type InboundOutcome = 'applied' | 'refused' | 'ignored' | 'unknown_order' | 'duplicate';

/** Insert-or-ignore; returns whether this delivery still needs processing. */
export const receive = (
  provider: InboundProvider,
  eventId: string,
  eventType: string,
  payload: string,
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    yield* db.run(
      'INSERT OR IGNORE INTO inbound_events (provider, event_id, event_type, received_at, payload) VALUES (?, ?, ?, ?, ?)',
      [provider, eventId, eventType, now, payload],
    );
    const rows = yield* db.all<{ processed_at: number | null; outcome: string | null }>(
      'SELECT processed_at, outcome FROM inbound_events WHERE provider = ? AND event_id = ?',
      [provider, eventId],
    );
    const row = rows[0];
    return row?.processed_at
      ? { pending: false as const, outcome: row.outcome ?? 'applied' }
      : { pending: true as const };
  }).pipe(Effect.orDie);

export const settle = (
  provider: InboundProvider,
  eventId: string,
  outcome: InboundOutcome,
  note?: string,
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    yield* db.run(
      'UPDATE inbound_events SET processed_at = ?, outcome = ? WHERE provider = ? AND event_id = ?',
      [now, note ? `${outcome}:${note}` : outcome, provider, eventId],
    );
  }).pipe(Effect.orDie);
