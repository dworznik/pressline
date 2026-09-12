import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The sample Engine's tests are the conformance suite run in-process (docs/SPEC.md seam 4).
export default defineConfig({
  test: { name: 'sample-engine', include: ['tests/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@pressline/contract': new URL('../../packages/contract/src/index.ts', import.meta.url)
        .pathname,
      '@pressline/render/node': new URL(
        '../../packages/render/src/backends/node.ts',
        import.meta.url,
      ).pathname,
      '@pressline/render/wasm': new URL(
        '../../packages/render/src/backends/wasm.ts',
        import.meta.url,
      ).pathname,
      '@pressline/render': new URL('../../packages/render/src/index.ts', import.meta.url).pathname,
      '@pressline/conformance': new URL('../../packages/conformance/src/index.ts', import.meta.url)
        .pathname,
    },
  },
})
