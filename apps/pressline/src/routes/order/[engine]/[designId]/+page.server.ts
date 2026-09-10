import { error } from '@sveltejs/kit';
import type { DesignPage } from '$lib/server/http/api';
import type { PageServerLoad } from './$types';

/**
 * Storefront design page (ticket #5). The data comes from the JSON API the
 * Effect handler serves: SvelteKit's `fetch` routes `/api/*` through
 * `hooks.server.ts` in-process, so there is one source of truth for what a
 * Design is and which Offers fit it.
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
  const res = await fetch(`/api/designs/${params.engine}/${params.designId}`);
  if (res.status === 404) error(404, 'We could not find that design.');
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
    error(503, body.reason ?? body.message ?? 'This shop is temporarily unavailable.');
  }
  if (!res.ok) error(502, 'The design app did not answer. Please try again in a moment.');
  const page = (await res.json()) as DesignPage;
  return { page };
};
