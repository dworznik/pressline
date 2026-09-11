# Pressline on Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dworznik/pressline)

What the button (or `wrangler deploy -c deploy/cloudflare/wrangler.toml`) sets up:

- **Worker** from `worker.ts`: SvelteKit's Cloudflare build plus a `scheduled` export for the nightly Reconciliation.
- **D1** bound as `DB`: the ledger. Migrations run on the first request per isolate, guarded against racing cold starts (ADR-0012).
- **Cron Trigger** at 03:17 UTC.
- **Secrets** you are prompted for: `PRINTFUL_TOKEN`, `STRIPE_SECRET_KEY`, `OPERATOR_TOKEN`, `SESSION_SECRET`, `ENGINE_SECRET_<SLUG>` per Engine, `RESEND_API_KEY` (optional).

Build with `PRESSLINE_ADAPTER=cloudflare pnpm --filter pressline build`; the Node SQLite driver is left out of that bundle.

After the first deploy:

1. Edit `pressline.config.ts` (Catalogue, Engines, branding), commit, redeploy.
2. `npx @pressline/cli --url https://<your worker> --token $OPERATOR_TOKEN webhooks register`, then `wrangler secret put STRIPE_WEBHOOK_SECRET`, `PRINTFUL_WEBHOOK_SECRET`, `PRINTFUL_WEBHOOK_PUBLIC_KEY` with what it printed.
3. `npx @pressline/cli … doctor`.

The sample Engine has its own manifest in `apps/sample-engine/deploy/wrangler.toml` (R2 for files, WASM rendering).
