// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  /** Set by Vite at build time (vite.config.ts); true only in a Playwright build. */
  const __PRESSLINE_E2E__: boolean;
  namespace App {
    // Platform bindings (D1, env) arrive here on Cloudflare (ADR-0012). Filled
    // in by the platform tickets; typed loosely until then.
    interface Platform {
      env?: Record<string, unknown>;
    }
  }
}

export {};
