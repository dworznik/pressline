import { Layer } from 'effect'
import type { Db, DbError } from './db'
import { migrate } from './migrate'

/** Any `Db` driver plus boot-time migrations (ADR-0012). */
export const layerDbMigrated = <E>(driver: Layer.Layer<Db, E | DbError>) =>
  Layer.merge(driver, Layer.effectDiscard(migrate()).pipe(Layer.provide(driver)))

/**
 * The migrated Db for this deployment (ADR-0008): D1 when Cloudflare hands
 * us the binding, libSQL when a Turso URL is set, else a SQLite file through
 * better-sqlite3, which only a Node bundle carries.
 */
export interface DbEnv {
  readonly DATABASE_PATH?: string | undefined
  readonly TURSO_DATABASE_URL?: string | undefined
  readonly TURSO_AUTH_TOKEN?: string | undefined
}

export const layerDbForPlatform = async (
  env: DbEnv,
  platform: App.Platform | undefined,
): Promise<Layer.Layer<Db, DbError>> => {
  const d1 = platform?.env?.DB
  if (d1) {
    const { layerSqliteD1 } = await import('./sqlite-d1')
    return layerDbMigrated(layerSqliteD1(d1))
  }
  if (env.TURSO_DATABASE_URL) {
    const { layerSqliteLibsql } = await import('./sqlite-libsql')
    return layerDbMigrated(
      layerSqliteLibsql({
        url: env.TURSO_DATABASE_URL,
        ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
      }),
    )
  }
  // A platform bundle without its database is a misconfiguration, not a reason to open a local file.
  if (__PRESSLINE_ADAPTER__ === 'cloudflare') {
    throw new Error('No database: bind D1 as `DB` in wrangler.toml')
  }
  if (__PRESSLINE_ADAPTER__ === 'vercel') {
    throw new Error('No database: attach Turso so TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set')
  }
  const { layerSqliteNode } = await import('./sqlite-node')
  return layerDbMigrated(layerSqliteNode(env.DATABASE_PATH ?? './pressline.db'))
}
