import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '$lib/server/db/db';
import { migrate, schemaVersion } from '$lib/server/db/migrate';
import { migrations } from '$lib/server/db/migrations';
import { layerSqliteLibsql } from '$lib/server/db/sqlite-libsql';
import { layerSqliteNode } from '$lib/server/db/sqlite-node';

describe('boot-time migrations', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pressline-mig-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('applies every migration once, and is idempotent', async () => {
    const layer = layerSqliteNode(join(dir, 'a.db'));
    const run = (eff: Effect.Effect<unknown, unknown, Db>) =>
      Effect.runPromise(eff.pipe(Effect.provide(layer)) as Effect.Effect<unknown, never>);
    expect(await run(migrate())).toBe(migrations.length);
    expect(await run(migrate())).toBe(migrations.length);
    expect(await run(schemaVersion)).toBe(migrations.length);
  });

  it('reports schema version 0 on a fresh database, before any migration', async () => {
    const layer = layerSqliteNode(join(dir, 'fresh.db'));
    expect(await Effect.runPromise(schemaVersion.pipe(Effect.provide(layer)))).toBe(0);
  });

  it('survives two cold starts racing on the same database', async () => {
    // Deterministic race: each migrator's first batch parks at a barrier until
    // both have arrived, so the two INSERTs into `migrations` genuinely
    // overlap and the loser exercises the primary-key recovery path.
    const path = join(dir, 'race.db');
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const gated = (path: string) =>
      Layer.map(layerSqliteNode(path), (ctx) => {
        const db = Context.get(ctx, Db);
        return Context.make(Db, {
          ...db,
          batch: (statements) =>
            Effect.promise(async () => {
              if (++arrived === 2) release();
              await barrier;
            }).pipe(Effect.flatMap(() => db.batch(statements))),
        });
      });
    const a = gated(path);
    const b = gated(path);
    const results = await Promise.all([
      Effect.runPromise(migrate().pipe(Effect.provide(a))),
      Effect.runPromise(migrate().pipe(Effect.provide(b))),
    ]);
    expect(arrived).toBeGreaterThanOrEqual(2);
    expect(results).toEqual([migrations.length, migrations.length]);
    const version = await Effect.runPromise(
      schemaVersion.pipe(Effect.provide(layerSqliteNode(path))),
    );
    expect(version).toBe(migrations.length);
  });

  it('rolls a failing migration back atomically', async () => {
    const layer = layerSqliteNode(join(dir, 'fail.db'));
    const bad = [
      { version: 1, name: 'bad', statements: ['CREATE TABLE t (x)', 'THIS IS NOT SQL'] },
    ];
    const exit = await Effect.runPromiseExit(migrate(bad).pipe(Effect.provide(layer)));
    expect(exit._tag).toBe('Failure');
    const tables = await Effect.runPromise(
      Effect.flatMap(Db, (db) =>
        db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name='t'`),
      ).pipe(Effect.provide(layer)),
    );
    expect(tables).toEqual([]);
  });
});

describe('boot-time migrations on libSQL (Turso on Vercel; a file here)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pressline-libsql-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = <A>(eff: Effect.Effect<A, unknown, Db>, file: string) =>
    Effect.runPromise(
      Effect.scoped(
        eff.pipe(Effect.provide(layerSqliteLibsql({ url: `file:${join(dir, file)}` }))),
      ) as Effect.Effect<A, never>,
    );

  it('applies every migration once through libSQL batches, and is idempotent', async () => {
    expect(await run(migrate(), 'a.db')).toBe(migrations.length);
    expect(await run(migrate(), 'a.db')).toBe(migrations.length);
    expect(await run(schemaVersion, 'a.db')).toBe(migrations.length);
  });

  it('rolls a failing migration back atomically on libSQL', async () => {
    const broken = [
      {
        version: 1,
        name: 'broken',
        statements: [
          'CREATE TABLE ok (id INTEGER PRIMARY KEY)',
          'CREATE TABLE ok (id INTEGER PRIMARY KEY)',
        ],
      },
    ];
    await expect(run(migrate(broken), 'b.db')).rejects.toThrow();
    const tables = await run(
      Effect.flatMap(Db, (db) =>
        db.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'",
        ),
      ),
      'b.db',
    );
    expect(tables).toEqual([]);
    expect(await run(schemaVersion, 'b.db')).toBe(0);
  });
});
