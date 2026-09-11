# Deploy

One deployable per platform (ADR-0012); `PRESSLINE_ADAPTER` picks the build (`cloudflare`, `vercel`, `node`).

|                   | Cloudflare                                                     | Vercel                                                       |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Button and notes  | [`deploy/cloudflare/`](../../deploy/cloudflare/README.md)      | [`deploy/vercel/`](../../deploy/vercel/README.md)            |
| Ledger (ADR-0008) | D1, bound as `DB`                                              | Turso (libSQL) via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` |
| Migrations        | at the first request per isolate, race-guarded                 | same                                                         |
| Reconciliation    | Cron Trigger → the Worker's `scheduled` export                 | Vercel Cron → `GET /api/cron/reconcile` with `CRON_SECRET`   |
| Manifest          | repo-root `wrangler.toml` + `deploy/cloudflare/worker.ts`      | `apps/pressline/vercel.json`                                 |
| Sample Engine     | `apps/sample-engine/deploy/wrangler.toml` (R2, WASM rendering) | `apps/sample-engine/vercel.json` (Blob, sharp)               |

Anywhere else: `PRESSLINE_ADAPTER=node pnpm --filter pressline build` and run `build/index.js` with `DATABASE_PATH` pointing at a SQLite file; schedule `POST /api/operator/reconcile` with the operator token.

## Go-live checklist

1. Secrets set: `PRINTFUL_TOKEN`, `STRIPE_SECRET_KEY` (live), `OPERATOR_TOKEN`, `SESSION_SECRET`, `ENGINE_SECRET_<SLUG>` per Engine, `RESEND_API_KEY` with `email.from`.
2. `pressline.config.ts`: Catalogue (`pressline catalogue search` for snippets), Engines, branding, legal URLs, `email.operator`, `checkout.publicUrl`.
3. `pressline webhooks register`, store the printed secrets, redeploy.
4. `pressline doctor` is all ✓; `demo: false`.
5. Read the Withdrawal Notice with counsel (docs/operator/stripe.md).
