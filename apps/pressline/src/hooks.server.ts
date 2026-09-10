import type { Handle } from '@sveltejs/kit';
import { isApiPath } from '$lib/server/http/handler';
import { getWebHandler } from '$lib/server/runtime';

// ADR-0012: one deployable. `/api/*` and `/webhooks/*` go to the Effect
// HttpApi; everything else is a SvelteKit route (Storefront, Operator View).
export const handle: Handle = async ({ event, resolve }) => {
  if (isApiPath(event.url.pathname)) {
    return getWebHandler(event.platform).handler(event.request);
  }
  return resolve(event);
};
