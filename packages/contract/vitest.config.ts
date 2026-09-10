import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'contract', include: ['tests/**/*.test.ts'], environment: 'node' },
});
