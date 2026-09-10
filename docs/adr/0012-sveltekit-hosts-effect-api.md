---
status: accepted
---

# One deployable: SvelteKit hosts the Storefront and mounts the Effect HttpApi

Pressline ships as a single SvelteKit app per platform, packaged by `adapter-cloudflare` and `adapter-vercel`. Storefront pages are SvelteKit routes; the Effect `HttpApi` (JSON API, Stripe and Printful webhooks, Engine-facing endpoints) is mounted from `hooks.server.ts`, whose `handle` delegates `/api/*` and `/webhooks/*` to the Effect web-standard handler. We rejected a separate Effect API service plus a SvelteKit front (two apps to provision, two env sets, CORS and internal auth, which makes one-click deploy dishonest) and "Effect only as a library inside `+server.ts` routes" (loses the schema-first `HttpApi` and the generated OpenAPI/client that the CLI and Engine developers rely on). We chose SvelteKit over server-rendered HTML from the Effect server for Storefront developer experience.

## Consequences

- Scheduled Reconciliation needs a per-platform shim: a Cloudflare Cron Trigger `scheduled` export beside the adapter output, and a Vercel Cron hitting an authenticated route.
- Platform bindings (D1, secrets) arrive via `event.platform`, so the Effect runtime is built from them and memoised per isolate.
- Operators wanting a custom Storefront use the JSON API; there is no embeddable widget in v1.
- Migrations run at boot (first request per isolate) via the `@effect/sql` Migrator, guarded by `PRAGMA user_version` and a batch-safe migrations table, because neither platform's deploy button runs a migration step. Webhook registration is a visible post-deploy step (`pressline webhooks register` or the Operator View banner), since it needs the deployed URL.
