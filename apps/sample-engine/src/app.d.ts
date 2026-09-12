/// <reference types="@cloudflare/workers-types" />
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    /** Cloudflare hands bindings here: the R2 bucket for files and the env. */
    interface Platform {
      env?: Record<string, unknown> & { FILES_BUCKET?: R2Bucket; ASSETS?: Fetcher }
    }
  }
}

export {}
