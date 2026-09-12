import { Effect } from 'effect'
import { Db } from './db'
import { migrations, type Migration } from './migrations'

/**
 * Boot-time migrator (ADR-0012). Neither deploy button runs a migration step,
 * so the app migrates on first request per isolate.
 *
 * Concurrency guard: `migrations.version` is the primary key and the row is
 * inserted in the SAME batch as the migration's statements. If two cold
 * starts race, the loser's batch fails (on the first DDL statement or on the
 * primary key, whichever comes first) and rolls back atomically; we then
 * re-read the applied set and, if the winner applied it, carry on. Any other
 * failure surfaces as the original DbError. No locks, no interactive
 * transactions, works on D1.
 */
const ensureTable = `CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`

const applied = Effect.gen(function* () {
  const db = yield* Db
  const rows = yield* db.all<{ version: number }>('SELECT version FROM migrations')
  return new Set(rows.map((r) => r.version))
})

const apply = (m: Migration) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.batch([
      ...m.statements.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        params: [m.version, m.name],
      },
    ])
  })

export const migrate = (list: ReadonlyArray<Migration> = migrations) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.run(ensureTable)
    let done = yield* applied
    for (const m of [...list].sort((a, b) => a.version - b.version)) {
      if (done.has(m.version)) continue
      yield* apply(m).pipe(
        Effect.catchAll((error) =>
          // Lost a race? The winner's row is visible now; otherwise it is a real failure.
          Effect.flatMap(applied, (now) => (now.has(m.version) ? Effect.void : Effect.fail(error))),
        ),
      )
      done = yield* applied
    }
    return done.size
  })

/** Highest applied migration version, 0 on a fresh database (before any migration has run). */
export const schemaVersion = Effect.gen(function* () {
  const db = yield* Db
  yield* db.run(ensureTable)
  const rows = yield* db.all<{ v: number | null }>('SELECT MAX(version) AS v FROM migrations')
  return rows[0]?.v ?? 0
})
