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
         min_delivery_days INTEGER,
         max_delivery_days INTEGER,
         cost_product INTEGER NOT NULL,
         cost_shipping INTEGER NOT NULL,
         cost_currency TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
    ],
  },
  {
    version: 6,
    name: 'orders',
    statements: [
      // The Order ledger (ADR-0009): a state row, append-only Transitions
      // with their Cause, and Inbound Events for at-most-once webhooks.
      `CREATE TABLE orders (
         id TEXT PRIMARY KEY,
         state TEXT NOT NULL,
         status_token TEXT NOT NULL,
         engine TEXT NOT NULL,
         design_id TEXT NOT NULL,
         offer_slug TEXT NOT NULL,
         variant_key TEXT NOT NULL,
         spec_hash TEXT NOT NULL,
         printfile_url TEXT NOT NULL,
         printfile_sha256 TEXT NOT NULL,
         printfile_content_type TEXT NOT NULL,
         quote_id TEXT NOT NULL,
         currency TEXT NOT NULL,
         retail INTEGER NOT NULL,
         shipping INTEGER NOT NULL,
         shipping_method TEXT NOT NULL,
         shipping_method_name TEXT NOT NULL,
         country TEXT NOT NULL,
         cost_product INTEGER NOT NULL,
         cost_shipping INTEGER NOT NULL,
         cost_currency TEXT NOT NULL,
         psp_session_id TEXT,
         psp_session_expires_at INTEGER,
         psp_payment_intent_id TEXT,
         amount_tax INTEGER,
         amount_total INTEGER,
         recipient TEXT,
         consent_accepted_at INTEGER,
         provider_order_id TEXT,
         tracking TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE INDEX orders_state ON orders (state)`,
      `CREATE UNIQUE INDEX orders_psp_session ON orders (psp_session_id)`,
      `CREATE TABLE order_transitions (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         order_id TEXT NOT NULL REFERENCES orders (id),
         from_state TEXT,
         to_state TEXT NOT NULL,
         cause TEXT NOT NULL,
         cause_ref TEXT,
         at INTEGER NOT NULL
       )`,
      `CREATE INDEX order_transitions_order ON order_transitions (order_id, id)`,
      `CREATE TABLE inbound_events (
         provider TEXT NOT NULL,
         event_id TEXT NOT NULL,
         event_type TEXT NOT NULL,
         received_at INTEGER NOT NULL,
         claimed_at INTEGER,
         processed_at INTEGER,
         outcome TEXT,
         note TEXT,
         payload TEXT NOT NULL,
         PRIMARY KEY (provider, event_id)
       )`,
    ],
  },
  {
    version: 7,
    name: 'transition_notes',
    statements: [
      // Transitions carry a free-text note (e.g. why a submit failed) for the Operator.
      `ALTER TABLE order_transitions ADD COLUMN note TEXT`,
    ],
  },
  {
    version: 8,
    name: 'order_emails',
    statements: [
      // Every Customer email per Order and kind: sent once, failures kept for retry.
      `CREATE TABLE order_emails (
         order_id TEXT NOT NULL REFERENCES orders (id),
         kind TEXT NOT NULL,
         sent_at INTEGER,
         provider_message_id TEXT,
         attempts INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (order_id, kind)
       )`,
      // The public origin the Order was placed on, for links in emails.
      `ALTER TABLE orders ADD COLUMN public_origin TEXT`,
    ],
  },
  {
    version: 9,
    name: 'order_preview_url',
    statements: [
      // The design's Preview URL at checkout time (immutable, ADR-0003), so emails
      // and the status page do not depend on the Engine answering later.
      `ALTER TABLE orders ADD COLUMN preview_url TEXT`,
    ],
  },
];
