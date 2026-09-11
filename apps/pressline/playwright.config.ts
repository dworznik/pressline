import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Storefront e2e (ticket #19) on the HTTP-seam harness: the built app runs
 * with `PRESSLINE_E2E=1`, which wires in-memory Engine, provider and PSP
 * seeded from `src/lib/server/e2e/seed.ts`. No network, no secrets.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env['CI'],
    env: {
      PRESSLINE_E2E: '1',
      // A fresh ledger per run: the seeded PSP hands out the same session ids every time.
      DATABASE_PATH: join(tmpdir(), `pressline-e2e-${Date.now()}.db`),
      OPERATOR_TOKEN: 'e2e-operator-token',
    },
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
