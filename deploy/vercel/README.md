# Pressline on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdworznik%2Fpressline&project-name=pressline&root-directory=apps%2Fpressline&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22database%22%2C%22integrationSlug%22%3A%22tursocloud%22%7D%5D&env=PRINTFUL_TOKEN%2CSTRIPE_SECRET_KEY%2COPERATOR_TOKEN%2CSESSION_SECRET%2CCRON_SECRET&envDescription=Your%20Printful%2C%20Stripe%20and%20operator%20secrets&envLink=https%3A%2F%2Fgithub.com%2Fdworznik%2Fpressline%2Fblob%2Fmain%2Fdeploy%2Fvercel%2FREADME.md)

What the button sets up:

- **Node runtime** SvelteKit build (`apps/pressline/vercel.json` sets `PRESSLINE_ADAPTER=vercel` in the build command; not Edge: the SQLite driver and Stripe's SDK need Node).
- **Turso** from the Marketplace: the integration sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; the libSQL driver is chosen when they are present (ADR-0008). Migrations run on the first request, race-guarded.
- **Cron** from `apps/pressline/vercel.json` (Vercel reads it from the project's root directory, which the button sets to `apps/pressline`): `GET /api/cron/reconcile` nightly with `Authorization: Bearer $CRON_SECRET` — set `CRON_SECRET` to any long random string.
- **Env prompts**: `PRINTFUL_TOKEN`, `STRIPE_SECRET_KEY`, `OPERATOR_TOKEN`, `SESSION_SECRET`, `CRON_SECRET`; add `ENGINE_SECRET_<SLUG>` per Engine and `RESEND_API_KEY` in the project settings.

After the first deploy: edit `pressline.config.ts`, redeploy; run `npx @pressline/cli --url https://<your project>.vercel.app --token $OPERATOR_TOKEN webhooks register` and add the printed webhook secrets to the project's env; then `… doctor`.

The sample Engine's manifest is `apps/sample-engine/vercel.json` (root directory `apps/sample-engine`; add the Vercel Blob store and `FILES=blob`, `ENGINE_SECRET`, `PRESSLINE_URL`, `PUBLIC_URL`).
