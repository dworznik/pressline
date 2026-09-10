import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-auto until the platform tickets (#23 Cloudflare, #24 Vercel)
    // wire the real adapters (ADR-0012).
    adapter: adapter(),
  },
};
