import Database from 'better-sqlite3';
import { Effect, Layer, type Scope } from 'effect';
import { Db, DbError, type DbService, type SqlParam } from './db';

/**
 * Db driver for local development and CI: a SQLite file (or ':memory:') via
 * better-sqlite3. D1 and libSQL drivers arrive with the platform tickets.
 */
export const makeSqliteNode = (path: string): Effect.Effect<DbService, DbError, Scope.Scope> =>
  Effect.gen(function* () {
    // Scoped: the native handle is closed when the owning layer is released
    // (the web handler's `dispose()`), so a test can delete its temp database.
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const d = new Database(path);
          d.pragma('journal_mode = WAL');
          d.pragma('busy_timeout = 5000');
          return d;
        },
        catch: (e) => new DbError({ message: `open ${path}: ${String(e)}` }),
      }),
      (d) => Effect.sync(() => d.close()),
    );

    const fail = (sql: string) => (e: unknown) => new DbError({ message: String(e), sql });
    const params = (p?: ReadonlyArray<SqlParam>) => (p ?? []) as SqlParam[];

    const runSync = (sql: string, p?: ReadonlyArray<SqlParam>) => {
      const stmt = db.prepare(sql);
      return stmt.reader ? (stmt.all(...params(p)), 0) : Number(stmt.run(...params(p)).changes);
    };

    const applyBatch = db.transaction(
      (statements: ReadonlyArray<{ sql: string; params?: ReadonlyArray<SqlParam> }>) => {
        for (const s of statements) runSync(s.sql, s.params);
      },
    );

    return {
      run: (sql, p) => Effect.try({ try: () => runSync(sql, p), catch: fail(sql) }),
      all: <Row extends object>(sql: string, p?: ReadonlyArray<SqlParam>) =>
        Effect.try({ try: () => db.prepare(sql).all(...params(p)) as Row[], catch: fail(sql) }),
      batch: (statements) =>
        Effect.try({
          try: () => applyBatch(statements),
          catch: fail(statements.map((s) => s.sql).join('; ')),
        }),
    } satisfies DbService;
  });

export const layerSqliteNode = (path: string) => Layer.scoped(Db, makeSqliteNode(path));
