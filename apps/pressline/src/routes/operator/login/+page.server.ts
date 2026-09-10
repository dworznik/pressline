import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/operator/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
  next: url.searchParams.get('next') ?? '/operator',
});

/** Exchange the operator token for a session cookie via the API, so the browser never keeps the token. */
export const actions: Actions = {
  default: async ({ request, fetch, cookies, url }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const res = await fetch('/api/operator/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return fail(401, { message: 'That token was not accepted.' });
    if (!res.ok) return fail(502, { message: 'Could not start a session. Try again.' });
    const { cookie, expiresAt } = (await res.json()) as { cookie: string; expiresAt: number };
    cookies.set(SESSION_COOKIE, cookie, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: url.protocol === 'https:',
      expires: new Date(expiresAt),
    });
    const next = String(form.get('next') ?? '/operator');
    redirect(303, next.startsWith('/operator') ? next : '/operator');
  },
};
