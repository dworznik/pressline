import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { operatorFetch, SESSION_COOKIE } from '$lib/server/operator/fetch';
import { OrderList } from '$lib/server/operator/read';
import type { PageServerLoad } from './$types';

const decode = Schema.decodeUnknownSync(OrderList);

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
  const q = new URLSearchParams();
  const state = url.searchParams.get('state');
  const before = url.searchParams.get('before');
  if (state) q.set('state', state);
  if (before) q.set('before', before);
  q.set('limit', '50');
  const res = await operatorFetch(fetch, cookies.get(SESSION_COOKIE), `/api/operator/orders?${q}`);
  if (!res.ok) error(res.status === 401 ? 401 : 502, 'Could not load orders.');
  return { list: decode(await res.json()), state: state ?? '' };
};
