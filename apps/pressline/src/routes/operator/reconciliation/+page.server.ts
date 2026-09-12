import { error, fail } from '@sveltejs/kit'
import { Schema } from 'effect'
import { operatorFetch, SESSION_COOKIE } from '$lib/server/operator/fetch'
import { ReconciliationReport } from '$lib/server/reconciliation/run'
import type { Actions, PageServerLoad } from './$types'

const decode = Schema.decodeUnknownSync(Schema.NullOr(ReconciliationReport))

export const load: PageServerLoad = async ({ fetch, cookies }) => {
  const res = await operatorFetch(
    fetch,
    cookies.get(SESSION_COOKIE),
    '/api/operator/reconciliation/latest',
  )
  if (!res.ok) error(res.status === 401 ? 401 : 502, 'Could not load the last Reconciliation.')
  return { report: decode(await res.json()) }
}

export const actions: Actions = {
  /** Run Reconciliation now; the page reloads with the fresh report. */
  run: async ({ fetch, cookies }) => {
    const res = await operatorFetch(fetch, cookies.get(SESSION_COOKIE), '/api/operator/reconcile', {
      method: 'POST',
    })
    if (!res.ok) return fail(res.status === 401 ? 401 : 502, { message: 'Reconciliation failed.' })
    return { ran: true }
  },
}
