import { redirect, type Handle } from '@sveltejs/kit';
import { isApiPath } from '$lib/server/http/handler';
import { hasOperatorSession, SESSION_COOKIE } from '$lib/server/operator/guard';
import { getWebHandler, isDemo, operatorSessionSecret } from '$lib/server/runtime';

// ADR-0012: one deployable. `/api/*` and `/webhooks/*` go to the Effect
// HttpApi; everything else is a SvelteKit route (Storefront, Operator View).
export const handle: Handle = async ({ event, resolve }) => {
  if (isApiPath(event.url.pathname)) {
    return getWebHandler(event.platform).handler(event.request);
  }
  // Operator View pages need a session cookie (ticket #14); the login page issues it.
  const path = event.url.pathname;
  if (
    !isDemo() &&
    (path === '/operator' || path.startsWith('/operator/')) &&
    path !== '/operator/login'
  ) {
    const ok = await hasOperatorSession(
      event.cookies.get(SESSION_COOKIE),
      operatorSessionSecret(event.platform),
    );
    if (!ok) redirect(303, `/operator/login?next=${encodeURIComponent(path)}`);
  }
  return resolve(event);
};
