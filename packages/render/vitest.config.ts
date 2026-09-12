import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Resolve the contract from source inside the monorepo so tests need no prior build.
    alias: { '@pressline/contract': new URL('../contract/src/index.ts', import.meta.url).pathname },
  },
  test: { name: 'render', include: ['tests/**/*.test.ts'], environment: 'node' },
})
