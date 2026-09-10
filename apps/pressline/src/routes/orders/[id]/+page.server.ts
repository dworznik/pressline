import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { describeState } from '$lib/server/orders/customer-language';
import { orderReference } from '$lib/server/orders/ids';
import { PublicOrder } from '$lib/server/orders/public';
import type { PageServerLoad } from './$types';

const decode = Schema.decodeUnknownSync(PublicOrder);

/** Order-status page (ticket #13): token-gated, no account. A wrong or missing token is a 404. */
export const load: PageServerLoad = async ({ params, url, fetch }) => {
  const token = url.searchParams.get('t') ?? '';
  const res = await fetch(`/api/orders/${params.id}?t=${encodeURIComponent(token)}`);
  if (res.status === 404) error(404, 'We could not find that order.');
  if (!res.ok) error(502, 'Please try again in a moment.');
  const order = decode(await res.json());
  return { order, display: describeState(order.state), reference: orderReference(order.id) };
};
