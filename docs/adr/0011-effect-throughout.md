---
status: accepted
---

# Effect throughout: platform HTTP, sql, Schema, Layers

Pressline is mostly "call an unreliable thing (Engine, Printful, Stripe), interpret the result, transition state, retry", which is Effect's sweet spot: typed errors, `Schedule` for polling and reconciliation, `Layer` for injecting `FulfilmentProvider`/`PSP`/`DesignSource`/`Db` per platform, and `Schema` for the canonical Printfile Spec, webhook payloads and the published Engine contract types. We chose to use Effect for the edges as well: `@effect/platform` HttpApi for HTTP on both Workers and Vercel, and `@effect/sql` (`sql-d1`, `sql-libsql`, `sql-sqlite-node` for local and CI) with its Migrator for persistence, so the codebase has one idiom. We considered "Effect core, Hono + Drizzle edges" to lower the ramp for drive-by open-source contributors and rejected it in favour of consistency; the ramp is mitigated by documentation rather than by mixing idioms.

## Consequences

- No Hono, no Drizzle. Contributors need Effect basics to touch any layer; the contributor guide must include an Effect primer.
- `@effect/sql` offers `withTransaction`, which D1 cannot honour; the `Db` service exposes only single statements and `batch`, by convention and lint rule (ADR-0008).
- Bundle size on Workers must be watched; `@effect/platform` plus core is a few hundred KB minified, within limits but not free.
