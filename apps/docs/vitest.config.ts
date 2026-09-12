import { defineConfig } from 'vitest/config';

// The architecture model suite (docs/architecture) runs here so `pnpm test`
// at the root picks it up as a project. Loading the LikeC4 language services
// takes a few seconds, hence the timeouts.
export default defineConfig({
  test: {
    name: 'docs',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
