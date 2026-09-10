---
status: accepted
---

# One SQLite-dialect schema: D1 on Cloudflare, libSQL/Turso on Vercel

Vercel sunset its first-party Postgres in June 2025 and offers databases only through Marketplace integrations, while Cloudflare has first-party D1 (SQLite). No single database is first-party on both, so the decision is the dialect. We chose SQLite: one Drizzle schema and migration set, with the D1 driver injected on Cloudflare and `@libsql/client` (Turso, one-click Marketplace provision) on Vercel; local development and CI use a plain SQLite file. Pressline stores no file bytes (ADR-0003), so no object store abstraction is needed. We rejected Postgres (third-party on both platforms and not provisionable by the Cloudflare template) and a hand-written store interface with separate D1 and Postgres backends (double the persistence code and tests).

## Consequences

- D1 has no interactive transactions, only `batch()`. The persistence layer exposes `run`, `all` and `batch` and nothing else; every logical write must fit in one `batch`.
- The ledger design must respect this: one event insert plus one order-row update per batch.
