import { Effect, Layer } from 'effect'
import { Db, DbError, type DbService, type SqlParam } from './db'

/**
 * Db driver for Cloudflare: the D1 binding from `event.platform` (ADR-0008,
 * ADR-0012). `batch` is D1's own batch, applied atomically.
 */
export const makeSqliteD1 = (d1: D1Database): DbService => {
  const fail = (sql: string) => (e: unknown) =>
    new DbError({ message: e instanceof Error ? e.message : String(e), sql })
  const bind = (sql: string, params?: ReadonlyArray<SqlParam>) =>
    d1.prepare(sql).bind(...((params ?? []) as unknown[]))
  return {
    run: (sql, params) =>
      Effect.tryPromise({
        try: async () => (await bind(sql, params).run()).meta.changes ?? 0,
        catch: fail(sql),
      }),
    all: <Row extends object>(sql: string, params?: ReadonlyArray<SqlParam>) =>
      Effect.tryPromise({
        try: async () => (await bind(sql, params).all<Row>()).results,
        catch: fail(sql),
      }),
    batch: (statements) =>
      Effect.tryPromise({
        try: async () => {
          if (statements.length === 0) return
          await d1.batch(statements.map((s) => bind(s.sql, s.params)))
        },
        catch: fail(statements.map((s) => s.sql).join('; ')),
      }),
  }
}

export const layerSqliteD1 = (d1: D1Database) => Layer.succeed(Db, makeSqliteD1(d1))
