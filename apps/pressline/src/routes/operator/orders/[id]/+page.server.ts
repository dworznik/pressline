import { error } from '@sveltejs/kit'
import { Schema } from 'effect'
import { operatorFetch, SESSION_COOKIE } from '$lib/server/operator/fetch'
import { OrderDetail } from '$lib/server/operator/read'
import type { PageServerLoad } from './$types'

const decode = Schema.decodeUnknownSync(OrderDetail)

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const res = await operatorFetch(
    fetch,
    cookies.get(SESSION_COOKIE),
    `/api/operator/orders/${params.id}`,
  )
  if (res.status === 404) error(404, 'No such order.')
  if (!res.ok) error(res.status === 401 ? 401 : 502, 'Could not load the order.')
  return { detail: decode(await res.json()) }
}
