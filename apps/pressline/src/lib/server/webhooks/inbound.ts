import { Clock, Effect } from 'effect';
import { Db } from '../db/db';

/**
 * Inbound Events (CONTEXT.md): every webhook delivery is recorded by the
 * provider's event ID so it is processed at most once (ADR-0007, ADR-0009).
 * `receive` inserts the row and *claims* it in one conditional UPDATE, so two
 * concurrent deliveries of the same event cannot both process it. A claim
 * that never settles (crash) expires after `CLAIM_TTL_MS`, so the provider's
 * retry is processed again; every Transition is state-guarded, so a replay
 * is safe.
 */
export type InboundProvider = 'stripe' | 'printful';

export type InboundOutcome = 'applied' | 'refused' | 'ignored' | 'unknown_order' | 'failed';

export const CLAIM_TTL_MS = 60_000;

export type Receipt =
  | { readonly pending: true }
  | { readonly pending: false; readonly outcome: string; readonly note?: string };

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
    const claimed = yield* db.run(
      `UPDATE inbound_events SET claimed_at = ?
       WHERE provider = ? AND event_id = ? AND processed_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)`,
      [now, provider, eventId, now - CLAIM_TTL_MS],
    );
    if (claimed === 1) return { pending: true } satisfies Receipt;
    const rows = yield* db.all<{
      processed_at: number | null;
      outcome: string | null;
      note: string | null;
    }>(
      'SELECT processed_at, outcome, note FROM inbound_events WHERE provider = ? AND event_id = ?',
      [provider, eventId],
    );
    const row = rows[0];
    return {
      pending: false,
      outcome: row?.processed_at ? (row.outcome ?? 'applied') : 'in_progress',
      ...(row?.note ? { note: row.note } : {}),
    } satisfies Receipt;
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
      'UPDATE inbound_events SET processed_at = ?, outcome = ?, note = ? WHERE provider = ? AND event_id = ?',
      [now, outcome, note ?? null, provider, eventId],
    );
  }).pipe(Effect.orDie);

/** Deliveries never settled (crash mid-processing) whose claim has lapsed: Reconciliation reprocesses them. */
export const listUnprocessed = () =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    return yield* db.all<{
      provider: InboundProvider;
      event_id: string;
      event_type: string;
      payload: string;
    }>(
      `SELECT provider, event_id, event_type, payload FROM inbound_events
       WHERE processed_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY received_at LIMIT 100`,
      [now - CLAIM_TTL_MS],
    );
  }).pipe(Effect.orDie);

/** Release a claim without settling, so the provider's retry is processed. */
export const release = (provider: InboundProvider, eventId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.run(
      'UPDATE inbound_events SET claimed_at = NULL WHERE provider = ? AND event_id = ?',
      [provider, eventId],
    );
  }).pipe(Effect.orDie);
