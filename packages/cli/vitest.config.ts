import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Resolve the workspace packages from source inside the monorepo so tests need no prior build.
    alias: {
      '@pressline/contract': new URL('../contract/src/index.ts', import.meta.url).pathname,
      '@pressline/conformance': new URL('../conformance/src/index.ts', import.meta.url).pathname,
    },
  },
  test: { name: 'cli', include: ['tests/**/*.test.ts'], environment: 'node' },
})
