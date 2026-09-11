import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Build-time switch for the Playwright run (ticket #19): only a build made with
  // PRESSLINE_E2E=1 contains the seeded in-memory services; a production bundle
  // never carries them, whatever the runtime environment says.
  define: { __PRESSLINE_E2E__: JSON.stringify(process.env['PRESSLINE_E2E'] === '1') },
});
