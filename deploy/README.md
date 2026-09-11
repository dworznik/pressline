# deploy/

Deploy templates pointing at `apps/*` (ADR-0012, ADR-0013): button configs and platform manifests, not packages.

- `cloudflare/` — Workers + D1 + Cron Trigger for Pressline; the sample Engine's Workers + R2 manifest lives in `apps/sample-engine/deploy/`.
- `vercel/` — the Deploy button and notes; Vercel reads `vercel.json` from each app's root (`apps/pressline/vercel.json` with the cron, `apps/sample-engine/vercel.json`).

Both apps read `PRESSLINE_ADAPTER` at build time (`cloudflare`, `vercel`, `node`, default `auto`).
