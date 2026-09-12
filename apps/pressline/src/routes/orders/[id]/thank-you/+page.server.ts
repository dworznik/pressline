import { error } from '@sveltejs/kit'
import { copy } from '$lib/copy'
import { Schema } from 'effect'
import { orderReference } from '$lib/server/orders/ids'
import { PublicOrder } from '$lib/server/orders/public'
import type { PageServerLoad } from './$types'

const decode = Schema.decodeUnknownSync(PublicOrder)

/** Where Stripe returns the Customer. The token in the URL is the Order's status token (ticket #13 reuses this). */
export const load: PageServerLoad = async ({ params, url, fetch }) => {
  const token = url.searchParams.get('t') ?? ''
  const res = await fetch(`/api/orders/${params.id}?t=${encodeURIComponent(token)}`)
  if (res.status === 404) error(404, copy.status.notFound)
  if (!res.ok) error(502, copy.status.tryAgain)
  const order = decode(await res.json())
  return { order, token, reference: orderReference(order.id) }
}
