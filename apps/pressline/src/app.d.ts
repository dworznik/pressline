// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // Platform bindings (D1, env) arrive here on Cloudflare (ADR-0012). Filled
    // in by the platform tickets; typed loosely until then.
    interface Platform {
      env?: Record<string, unknown>;
    }
  }
}

export {};
