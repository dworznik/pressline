import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Seam 1: the HTTP surface of the bridge with in-memory layers (docs/SPEC.md →
// Testing Decisions). Tests boot the Effect web handler directly; SvelteKit is
// not involved, so no Svelte plugin is needed here.
export default defineConfig({
  test: {
    name: 'pressline',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@pressline/contract': new URL('../../packages/contract/src/index.ts', import.meta.url)
        .pathname,
      '@pressline/cli': new URL('../../packages/cli/src/index.ts', import.meta.url).pathname,
    },
  },
});
