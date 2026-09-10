import { Effect } from 'effect';
import { Db, DbError } from './db';
import { migrations, type Migration } from './migrations';

/**
 * Boot-time migrator (ADR-0012). Neither deploy button runs a migration step,
 * so the app migrates on first request per isolate.
 *
 * Concurrency guard: `migrations.version` is the primary key and the row is
 * inserted in the SAME batch as the migration's statements. If two cold
 * starts race, the second batch fails on the primary key and rolls back
 * atomically; we then re-read the applied set and continue. No locks, no
 * interactive transactions, works on D1.
 */
const ensureTable = `CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

const applied = Effect.gen(function* () {
  const db = yield* Db;
  const rows = yield* db.all<{ version: number }>('SELECT version FROM migrations');
  return new Set(rows.map((r) => r.version));
});

const apply = (m: Migration) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.batch([
      ...m.statements.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        params: [m.version, m.name],
      },
    ]);
  });

const isRace = (e: DbError) => /UNIQUE|PRIMARY KEY|constraint/i.test(e.message);

export const migrate = (list: ReadonlyArray<Migration> = migrations) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.run(ensureTable);
    let done = yield* applied;
    for (const m of [...list].sort((a, b) => a.version - b.version)) {
      if (done.has(m.version)) continue;
      yield* apply(m).pipe(Effect.catchIf(isRace, () => Effect.void));
      done = yield* applied;
      if (!done.has(m.version))
        return yield* new DbError({ message: `migration ${m.version} (${m.name}) did not apply` });
    }
    return done.size;
  });

/** Highest applied migration version, 0 on a fresh database. */
export const schemaVersion = Effect.gen(function* () {
  const db = yield* Db;
  const rows = yield* db.all<{ v: number | null }>('SELECT MAX(version) AS v FROM migrations');
  return rows[0]?.v ?? 0;
});
