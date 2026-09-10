import { Layer } from 'effect';
import { migrate } from './migrate';
import { layerSqliteNode } from './sqlite-node';

/** A migrated SQLite-file `Db`: the driver plus boot-time migrations (ADR-0012). */
export const layerSqliteMigrated = (path: string) => {
  const driver = layerSqliteNode(path);
  return Layer.merge(driver, Layer.effectDiscard(migrate()).pipe(Layer.provide(driver)));
};
