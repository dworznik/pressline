import auto from '@sveltejs/adapter-auto'
import cloudflare from '@sveltejs/adapter-cloudflare'
import node from '@sveltejs/adapter-node'
import vercel from '@sveltejs/adapter-vercel'

/**
 * One deployable per platform (ADR-0012). `PRESSLINE_ADAPTER` picks the
 * adapter at build time: `cloudflare`, `vercel`, `node`, or (default) `auto`,
 * which detects Cloudflare Pages and Vercel from their build environments.
 * The deploy templates set it explicitly. Shared by both apps (ADR-0013: deploy/
 * points at apps/*), so the adapters are root devDependencies.
 */
export const pickAdapter = () => {
  switch (process.env['PRESSLINE_ADAPTER']) {
    case 'cloudflare':
      // The app's own build config: wrangler's find-up must not reach the repo-root
      // wrangler.toml, whose `main` is the hand-written Worker shim.
      return cloudflare({ config: 'wrangler.build.toml' })
    case 'vercel':
      // Node runtime, not Edge: the SQLite drivers and Stripe's SDK need it (ticket #24).
      return vercel({ runtime: 'nodejs22.x' })
    case 'node':
      return node()
    default:
      return auto()
  }
}
