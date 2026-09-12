import { pickAdapter } from '../../deploy/adapter.js'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // PRESSLINE_ADAPTER picks cloudflare / vercel / node; deploy/ has the manifests.
    adapter: pickAdapter(),
    // Workspace packages from source, so dev and tests need no prior build.
    alias: {
      '@pressline/contract': '../../packages/contract/src/index.ts',
      // Sub-paths before the bare name: aliases match by prefix, in order.
      '@pressline/render/node': '../../packages/render/src/backends/node.ts',
      '@pressline/render/wasm': '../../packages/render/src/backends/wasm.ts',
      '@pressline/render': '../../packages/render/src/index.ts',
      '@pressline/conformance': '../../packages/conformance/src/index.ts',
    },
  },
}
