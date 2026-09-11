import { Layer } from 'effect';
import type { Db, DbError } from './db';
import { migrate } from './migrate';

/** Any `Db` driver plus boot-time migrations (ADR-0012). */
export const layerDbMigrated = <E>(driver: Layer.Layer<Db, E | DbError>) =>
  Layer.merge(driver, Layer.effectDiscard(migrate()).pipe(Layer.provide(driver)));

/**
 * The migrated Db for this deployment (ADR-0008): D1 when Cloudflare hands
 * us the binding, libSQL when a Turso URL is set, else a SQLite file through
 * better-sqlite3, which only a Node bundle carries.
 */
export const layerDbForPlatform = async (
  env: Record<string, unknown>,
  platform: App.Platform | undefined,
): Promise<Layer.Layer<Db, DbError>> => {
  const d1 = platform?.env?.DB;
  if (d1) {
    const { layerSqliteD1 } = await import('./sqlite-d1');
    return layerDbMigrated(layerSqliteD1(d1));
  }
  const url = env['TURSO_DATABASE_URL'];
  if (typeof url === 'string' && url.length > 0) {
    const token = env['TURSO_AUTH_TOKEN'];
    const { layerSqliteLibsql } = await import('./sqlite-libsql');
    return layerDbMigrated(
      layerSqliteLibsql({ url, ...(typeof token === 'string' ? { authToken: token } : {}) }),
    );
  }
  if (__PRESSLINE_ADAPTER__ === 'cloudflare') {
    throw new Error('No database: bind D1 as `DB` in wrangler.toml (deploy/cloudflare)');
  }
  const path = env['DATABASE_PATH'];
  const { layerSqliteNode } = await import('./sqlite-node');
  return layerDbMigrated(
    layerSqliteNode(typeof path === 'string' && path ? path : './pressline.db'),
  );
};
