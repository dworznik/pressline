/// <reference types="@cloudflare/workers-types" />
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  /** Set by Vite at build time (vite.config.ts); true only in a Playwright build. */
  const __PRESSLINE_E2E__: boolean
  /** The adapter the bundle was built for: 'cloudflare' | 'vercel' | 'node' | 'auto'. */
  const __PRESSLINE_ADAPTER__: string
  namespace App {
    // Platform bindings (D1, env) arrive here on Cloudflare (ADR-0012). Filled
    // in by the platform tickets; typed loosely until then.
    interface Platform {
      /** Cloudflare: secrets, vars and the D1 binding `DB` (deploy/cloudflare/wrangler.toml). */
      env?: Record<string, unknown> & { DB?: D1Database }
      context?: { waitUntil(promise: Promise<unknown>): void }
    }
  }
}

export {}
