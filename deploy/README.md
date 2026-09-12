# deploy/

Deploy templates pointing at `apps/*` (ADR-0012, ADR-0013): button configs and platform manifests, not packages.

- `cloudflare/` — the Worker entry (`worker.ts`, with the `scheduled` export) and notes; the manifest is the repo-root `wrangler.toml`. The sample Engine's Workers + R2 manifest lives in `apps/sample-engine/deploy/`.
- `vercel/` — the Deploy button and notes; Vercel reads `vercel.json` from each app's root (`apps/pressline/vercel.json` with the cron, `apps/sample-engine/vercel.json`).

Both apps read `PRESSLINE_ADAPTER` at build time (`cloudflare`, `vercel`, `node`, default `auto`).

- The docs site (`apps/docs`) is static Astro: `apps/docs/vercel.json` (root directory `apps/docs`) or any static host serving `apps/docs/dist` — GitHub Pages today (`.github/workflows/docs-pages.yml`).
