import { globSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Root runner: every workspace package with its own vitest config joins as a
// project, so `pnpm test` at the root runs them all. Until the first package
// lands, there are no projects and the run passes empty.
const projects = globSync(['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts']);

export default defineConfig({
  test: projects.length > 0 ? { projects, passWithNoTests: true } : { passWithNoTests: true },
});
