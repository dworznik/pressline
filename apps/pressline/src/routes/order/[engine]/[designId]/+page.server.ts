import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { copy } from '$lib/copy';
import { DesignPage } from '$lib/server/http/api';
import type { PageServerLoad } from './$types';

const decodePage = Schema.decodeUnknownSync(DesignPage);

/**
 * Storefront design page (ticket #5). The data comes from the JSON API the
 * Effect handler serves: SvelteKit's `fetch` routes `/api/*` through
 * `hooks.server.ts` in-process, so there is one source of truth for what a
 * Design is and which Offers fit it.
 */
export const load: PageServerLoad = async ({ params, fetch, url }) => {
  const res = await fetch(`/api/designs/${params.engine}/${params.designId}`);
  if (res.status === 404) error(404, copy.design.notFound);
  // Operators see the reason on /api/health; Customers get a plain message.
  if (res.status === 503) error(503, copy.design.unavailable);
  if (!res.ok) error(502, copy.design.engineDown);
  return {
    page: decodePage(await res.json()),
    cancelled: url.searchParams.get('cancelled') === '1',
  };
};
