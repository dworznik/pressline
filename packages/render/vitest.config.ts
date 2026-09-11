import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'render', include: ['tests/**/*.test.ts'], environment: 'node' },
});
