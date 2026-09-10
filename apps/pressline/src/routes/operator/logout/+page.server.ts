import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/operator/session';
import type { Actions } from './$types';

export const actions: Actions = {
  default: ({ cookies }) => {
    cookies.delete(SESSION_COOKIE, { path: '/' });
    redirect(303, '/operator/login');
  },
};
