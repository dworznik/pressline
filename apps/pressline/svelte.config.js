import { pickAdapter } from './adapter.js';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: pickAdapter(),
    // Resolve the contract package from source inside the monorepo so dev,
    // check and tests need no prior build of packages/contract.
    alias: {
      '@pressline/contract': '../../packages/contract/src/index.ts',
      // Tests drive the CLI against the in-process harness (ticket #16); the app itself never imports it.
      '@pressline/cli': '../../packages/cli/src/index.ts',
    },
  },
};
