/// <reference types="@cloudflare/workers-types" />
// The Worker entry for Pressline on Cloudflare: SvelteKit's generated worker
// plus the `scheduled` export that Cron Triggers call (ADR-0012). The
// scheduled run goes through the same HTTP entry the Vercel cron uses, so
// there is exactly one Reconciliation path. The bearer is minted once per
// isolate in module scope (env objects are not guaranteed to persist between
// invocations) and never leaves it.
import app from '../../apps/pressline/.svelte-kit/cloudflare/_worker.js'

type Env = Record<string, unknown>
const worker = app as ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>['fetch']> }

const CRON_SECRET = crypto.randomUUID()
const withSecret = (env: Env): Env => ({ ...env, CRON_SECRET })

export default {
  fetch: (request, env, ctx) => worker.fetch(request, withSecret(env), ctx),
  scheduled: async (_event, env, ctx) => {
    const request = new Request('https://pressline.internal/api/cron/reconcile', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }) as unknown as Parameters<typeof worker.fetch>[0]
    const res = await worker.fetch(request, withSecret(env), ctx)
    if (!res.ok) throw new Error(`reconciliation answered ${res.status}: ${await res.text()}`)
  },
} satisfies ExportedHandler<Env>
