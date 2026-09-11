import { createClient, type Client, type InValue } from '@libsql/client';
import { Effect, Layer, type Scope } from 'effect';
import { Db, DbError, type DbService, type SqlParam } from './db';

/**
 * Db driver for Vercel (Turso / libSQL over HTTP) and any `file:` URL. A
 * `batch` is libSQL's own batch in `write` mode: one transaction, all or
 * nothing (ADR-0008).
 */
export const makeSqliteLibsql = (options: {
  readonly url: string;
  readonly authToken?: string;
}): Effect.Effect<DbService, DbError, Scope.Scope> =>
  Effect.gen(function* () {
    const client: Client = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          createClient({
            url: options.url,
            ...(options.authToken ? { authToken: options.authToken } : {}),
          }),
        catch: (e) => new DbError({ message: `open ${options.url}: ${String(e)}` }),
      }),
      (c) => Effect.sync(() => c.close()),
    );
    const fail = (sql: string) => (e: unknown) =>
      new DbError({ message: e instanceof Error ? e.message : String(e), sql });
    const args = (p?: ReadonlyArray<SqlParam>) => (p ?? []) as InValue[];
    return {
      run: (sql, p) =>
        Effect.tryPromise({
          try: async () => (await client.execute({ sql, args: args(p) })).rowsAffected,
          catch: fail(sql),
        }),
      all: <Row extends object>(sql: string, p?: ReadonlyArray<SqlParam>) =>
        Effect.tryPromise({
          try: async () => (await client.execute({ sql, args: args(p) })).rows as unknown as Row[],
          catch: fail(sql),
        }),
      batch: (statements) =>
        Effect.tryPromise({
          try: async () => {
            if (statements.length === 0) return;
            await client.batch(
              statements.map((s) => ({ sql: s.sql, args: args(s.params) })),
              'write',
            );
          },
          catch: fail(statements.map((s) => s.sql).join('; ')),
        }),
    } satisfies DbService;
  });

export const layerSqliteLibsql = (options: { readonly url: string; readonly authToken?: string }) =>
  Layer.scoped(Db, makeSqliteLibsql(options));
