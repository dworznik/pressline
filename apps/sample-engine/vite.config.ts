import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // opentype.js has a CommonJS `main` and no `exports` map: Node's ESM loader
  // then misses its named exports at runtime. Bundle its ESM build instead.
  ssr: { noExternal: ['opentype.js'] },
  // Let a dev tunnel (ngrok, cloudflared) reach `pnpm dev`, so a hosted
  // Pressline and Printful can fetch designs and files from a local Engine.
  server: { allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com'] },
});
