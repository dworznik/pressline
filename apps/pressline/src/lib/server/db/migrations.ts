/**
 * Ordered, append-only. Each migration is applied as ONE batch together with
 * its bookkeeping row, so it is all-or-nothing on every driver (ADR-0008).
 * Never edit an applied migration; add the next one.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: ReadonlyArray<string>;
}

export const migrations: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: 'instance',
    statements: [
      `CREATE TABLE instance (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         installed_at TEXT NOT NULL
       )`,
      `INSERT INTO instance (id, installed_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ],
  },
];
