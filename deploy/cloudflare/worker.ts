/// <reference types="@cloudflare/workers-types" />
// The Worker entry for Pressline on Cloudflare: SvelteKit's generated worker
// plus the `scheduled` export that Cron Triggers call (ADR-0012). The
// scheduled run goes through the same HTTP entry the Vercel cron uses, so
// there is exactly one Reconciliation path; the bearer is minted per isolate
// and never leaves it.
import app from '../../apps/pressline/.svelte-kit/cloudflare/_worker.js';

interface Env {
  CRON_SECRET?: string;
  [key: string]: unknown;
}

const cronSecret = (env: Env) => {
  env.CRON_SECRET ??= crypto.randomUUID();
  return env.CRON_SECRET;
};

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    (app as { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> }).fetch(
      request,
      { ...env, CRON_SECRET: cronSecret(env) },
      ctx,
    ),
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    const secret = cronSecret(env);
    const res = await (
      app as { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> }
    ).fetch(
      new Request('https://pressline.internal/api/cron/reconcile', {
        headers: { authorization: `Bearer ${secret}` },
      }),
      { ...env, CRON_SECRET: secret },
      ctx,
    );
    if (!res.ok) throw new Error(`reconciliation answered ${res.status}: ${await res.text()}`);
  },
};
