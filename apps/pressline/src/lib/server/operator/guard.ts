import { Effect } from 'effect';
import { SESSION_COOKIE, verifySession } from './session';

/** Session check for `/operator/*` pages, from the request's cookies. */
export const hasOperatorSession = (cookieValue: string | undefined, sessionSecret: string) =>
  cookieValue
    ? Effect.runPromise(verifySession(sessionSecret, cookieValue, Date.now())).then(
        (exp) => exp !== undefined,
      )
    : Promise.resolve(false);

export { SESSION_COOKIE };
