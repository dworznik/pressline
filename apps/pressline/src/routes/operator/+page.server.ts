import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { operatorFetch, SESSION_COOKIE } from '$lib/server/operator/fetch';
import { InstanceHealth } from '$lib/server/operator/read';
import type { PageServerLoad } from './$types';

const decode = Schema.decodeUnknownSync(InstanceHealth);

export const load: PageServerLoad = async ({ fetch, cookies }) => {
  const res = await operatorFetch(fetch, cookies.get(SESSION_COOKIE), '/api/operator/health');
  if (!res.ok) error(res.status === 401 ? 401 : 502, 'Could not load instance health.');
  return { health: decode(await res.json()) };
};
