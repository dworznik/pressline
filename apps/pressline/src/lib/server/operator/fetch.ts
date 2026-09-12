import { SESSION_COOKIE } from './session'

/** Operator View pages call the operator API with the session cookie they received. */
export const operatorFetch = (
  fetch: typeof globalThis.fetch,
  cookie: string | undefined,
  path: string,
  init: { method?: string } = {},
) => fetch(path, { ...init, headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} })

export { SESSION_COOKIE }
