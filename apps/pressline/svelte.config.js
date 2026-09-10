import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-auto until the platform tickets (#23 Cloudflare, #24 Vercel)
    // wire the real adapters (ADR-0012).
    adapter: adapter(),
    // Resolve the contract package from source inside the monorepo so dev,
    // check and tests need no prior build of packages/contract.
    alias: { '@pressline/contract': '../../packages/contract/src/index.ts' },
  },
};
