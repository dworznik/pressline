import { runReconciliation } from './run'

/**
 * The scheduled entry for platforms that call into the process instead of
 * over HTTP: Cloudflare Cron Triggers invoke the Worker's `scheduled` export,
 * which the Cloudflare deploy (#23) wires to run this effect on the same
 * services layer the HTTP handler uses. Vercel Cron uses `GET /api/cron/reconcile`.
 */
export const scheduledReconciliation = runReconciliation('cron')
