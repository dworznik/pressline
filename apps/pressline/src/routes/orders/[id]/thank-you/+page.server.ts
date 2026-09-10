import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { PublicOrder } from '$lib/server/orders/public';
import type { PageServerLoad } from './$types';

const decode = Schema.decodeUnknownSync(PublicOrder);

/** Where Stripe returns the Customer. The token in the URL is the Order's status token (ticket #13 reuses this). */
export const load: PageServerLoad = async ({ params, url, fetch }) => {
  const token = url.searchParams.get('t') ?? '';
  const res = await fetch(`/api/orders/${params.id}?t=${encodeURIComponent(token)}`);
  if (res.status === 404) error(404, 'We could not find that order.');
  if (!res.ok) error(502, 'Please try again in a moment.');
  return { order: decode(await res.json()) };
};
