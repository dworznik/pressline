---
title: Deploy
description: One click on Cloudflare or Vercel, or a Node build anywhere.
---

Pressline is one SvelteKit deployable per platform; `PRESSLINE_ADAPTER` picks the build.

|                        | Cloudflare Workers                                                                                                                                                                                            | Vercel                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Button                 | [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/dworznik/pressline) — notes in [`deploy/cloudflare/`](https://github.com/dworznik/pressline/tree/main/deploy/cloudflare) | Button and notes in [`deploy/vercel/`](https://github.com/dworznik/pressline/tree/main/deploy/vercel) |
| Ledger                 | D1, bound as `DB`                                                                                                                                                                                             | Turso (libSQL) from the Marketplace prompt                                                            |
| Migrations             | run at the first request per isolate, guarded against racing cold starts                                                                                                                                      | same                                                                                                  |
| Nightly Reconciliation | Cron Trigger → the Worker's `scheduled` export                                                                                                                                                                | Vercel Cron → `GET /api/cron/reconcile` with `CRON_SECRET`                                            |

Anywhere else: `PRESSLINE_ADAPTER=node pnpm --filter pressline build`, run `build/index.js` with `DATABASE_PATH` pointing at a SQLite file, and schedule `POST /api/operator/reconcile` with the operator token.

The committed config ships with an empty Catalogue and one placeholder Engine (`sample` at `localhost:5174`) that you replace; without secrets the instance still boots, and [`pressline doctor`](/reference/cli/) tells you what is missing. Continue with [Configure](/operator/configure/).

The sample Engine deploys the same way from `apps/sample-engine` (R2 or Vercel Blob for its files).
