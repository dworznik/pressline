---
status: accepted
---

# Effect throughout: platform HTTP, sql, Schema, Layers

Pressline is mostly "call an unreliable thing (Engine, Printful, Stripe), interpret the result, transition state, retry", which is Effect's sweet spot: typed errors, `Schedule` for polling and reconciliation, `Layer` for injecting `FulfillmentProvider`/`PSP`/`DesignSource`/`Db` per platform, and `Schema` for the canonical Printfile Spec, webhook payloads and the published Engine contract types. We chose to use Effect for the edges as well: `@effect/platform` HttpApi for HTTP on both Workers and Vercel, so the codebase has one idiom. Persistence is a three-method Effect service of our own (`run`, `all`, `batch`) over each platform's native driver (better-sqlite3 locally and in CI, `@libsql/client` on Vercel, D1 on Cloudflare) with a small in-house migrator, rather than `@effect/sql`: its client and Migrator center on interactive transactions, which D1 does not have (ADR-0008), and wrapping them would have meant banning most of their surface. We considered "Effect core, Hono + Drizzle edges" to lower the ramp for drive-by open-source contributors and rejected it in favor of consistency; the ramp is mitigated by documentation rather than by mixing idioms.

## Consequences

- No Hono, no Drizzle. Contributors need Effect basics to touch any layer; the contributor guide must include an Effect primer.
- The `Db` service exposes only single statements and `batch`; `withTransaction` is banned by lint (ADR-0008). Drivers implement `batch` with their native atomic primitive.
- Bundle size on Workers must be watched; `@effect/platform` plus core is a few hundred KB minified, within limits but not free.
