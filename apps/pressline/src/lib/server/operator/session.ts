import { Effect } from 'effect';
import { timingSafeEqual } from '../security';

/**
 * Operator session cookie (ticket #14, ADR-0001/0014): one credential, the
 * OPERATOR_TOKEN, exchanged for a short-lived signed cookie so the browser
 * never carries the token itself. Value: `<expiresAt>.<hmac>`; the HMAC key
 * is SESSION_SECRET (or the token when no separate secret is configured).
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'pressline_operator';

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

const hmac = (secret: string, message: string) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  });

export const signSession = (secret: string, expiresAt: number) =>
  hmac(secret, `operator:${expiresAt}`).pipe(Effect.map((sig) => `${expiresAt}.${sig}`));

/** Valid → the expiry; anything else (bad shape, wrong signature, expired) → undefined. */
export const verifySession = (secret: string, value: string, now: number) =>
  Effect.gen(function* () {
    const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(value);
    if (!m) return undefined;
    const expiresAt = Number(m[1]);
    if (expiresAt <= now) return undefined;
    const expected = yield* hmac(secret, `operator:${expiresAt}`);
    return timingSafeEqual(expected, m[2]!) ? expiresAt : undefined;
  });
