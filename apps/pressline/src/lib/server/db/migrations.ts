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
  {
    version: 2,
    name: 'catalogue_cache',
    statements: [
      `CREATE TABLE catalogue_cache (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
    ],
  },
  {
    version: 3,
    name: 'printfiles',
    statements: [
      // A validated Printfile per (Engine, Design, Spec Hash): the Storefront
      // and checkout reuse it; the bytes stay at the Engine's URL (ADR-0003).
      `CREATE TABLE printfiles (
         engine TEXT NOT NULL,
         design_id TEXT NOT NULL,
         spec_hash TEXT NOT NULL,
         url TEXT NOT NULL,
         sha256 TEXT NOT NULL,
         width INTEGER NOT NULL,
         height INTEGER NOT NULL,
         bytes INTEGER NOT NULL,
         content_type TEXT NOT NULL,
         validated_at INTEGER NOT NULL,
         PRIMARY KEY (engine, design_id, spec_hash)
       )`,
    ],
  },
  {
    version: 4,
    name: 'printfile_rejections',
    statements: [
      // An Engine's 422 for (Design, Offer) hides that Offer for the Design so
      // the Storefront stops offering it and nobody re-asks the Engine.
      `CREATE TABLE printfile_rejections (
         engine TEXT NOT NULL,
         design_id TEXT NOT NULL,
         offer_slug TEXT NOT NULL,
         code TEXT NOT NULL,
         message TEXT NOT NULL,
         rejected_at INTEGER NOT NULL,
         PRIMARY KEY (engine, design_id, offer_slug)
       )`,
    ],
  },
  {
    version: 5,
    name: 'quotes',
    statements: [
      // A locked Quote (ADR-0010): what the Customer will pay, plus the
      // Operator's Provider Cost Estimate for margin reporting.
      `CREATE TABLE quotes (
         id TEXT PRIMARY KEY,
         engine TEXT NOT NULL,
         design_id TEXT NOT NULL,
         offer_slug TEXT NOT NULL,
         variant_key TEXT NOT NULL,
         spec_hash TEXT NOT NULL,
         country TEXT NOT NULL,
         state TEXT,
         currency TEXT NOT NULL,
         retail INTEGER NOT NULL,
         shipping INTEGER NOT NULL,
         shipping_method TEXT NOT NULL,
         shipping_method_name TEXT NOT NULL,
         cost_product INTEGER NOT NULL,
         cost_shipping INTEGER NOT NULL,
         cost_currency TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
    ],
  },
];
