import type { Handle } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

/** The DesignSource protocol lives at `/designs/*` and `/health`; everything else is the designer. */
const isProtocolPath = (p: string) =>
  p === '/health' || p === '/designs' || p.startsWith('/designs/');

export const handle: Handle = async ({ event, resolve }) => {
  if (isProtocolPath(event.url.pathname)) {
    return (await getRuntime(event.platform)).handler(event.request);
  }
  return resolve(event);
};
