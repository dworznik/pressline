import auto from '@sveltejs/adapter-auto';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import vercel from '@sveltejs/adapter-vercel';

/**
 * One deployable per platform (ADR-0012). `PRESSLINE_ADAPTER` picks the
 * adapter at build time: `cloudflare`, `vercel`, `node`, or (default) `auto`,
 * which detects Cloudflare Pages and Vercel from their build environments.
 * The deploy templates set it explicitly.
 */
export const pickAdapter = () => {
  switch (process.env['PRESSLINE_ADAPTER']) {
    case 'cloudflare':
      return cloudflare({ config: process.env['WRANGLER_CONFIG'] });
    case 'vercel':
      // Node runtime, not Edge: the SQLite drivers and Stripe's SDK need it (ticket #24).
      return vercel({ runtime: 'nodejs22.x' });
    case 'node':
      return node();
    default:
      return auto();
  }
};
