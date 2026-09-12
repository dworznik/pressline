import { Context, Schema } from 'effect'
import type { Effect } from 'effect'

/**
 * The only persistence API in Pressline (ADR-0008): single statements and
 * batches. No interactive transactions exist because D1 has none; a batch is
 * applied atomically by every driver (D1 batch, libSQL batch, better-sqlite3
 * transaction). Drivers are injected per platform.
 */
export type SqlParam = string | number | bigint | null | Uint8Array

export interface Statement {
  readonly sql: string
  readonly params?: ReadonlyArray<SqlParam>
}

export class DbError extends Schema.TaggedError<DbError>()('DbError', {
  message: Schema.String,
  sql: Schema.optional(Schema.String),
}) {}

export interface DbService {
  /** Execute one statement; returns the number of changed rows. */
  readonly run: (sql: string, params?: ReadonlyArray<SqlParam>) => Effect.Effect<number, DbError>
  /** Query rows. */
  readonly all: <Row extends object = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<SqlParam>,
  ) => Effect.Effect<ReadonlyArray<Row>, DbError>
  /** Apply statements atomically: all or nothing. */
  readonly batch: (statements: ReadonlyArray<Statement>) => Effect.Effect<void, DbError>
}

export class Db extends Context.Tag('pressline/Db')<Db, DbService>() {}
