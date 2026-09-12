import starlight from '@astrojs/starlight'
import { defineConfig, passthroughImageService } from 'astro/config'

// The docs site (ticket #26): a static Starlight site. Deploy the `dist/`
// output anywhere static; GitHub Pages publishes it at /pressline (DOCS_BASE),
// a custom domain would serve it from /. Markdown links are site-absolute; scripts/apply-base.mjs
// prefixes them after the build when a base is set (Astro's Markdown processor has no hook for it).
const base = (process.env['DOCS_BASE'] ?? '/').replace(/\/$/, '') || '/'

export default defineConfig({
  site: process.env['DOCS_SITE'] ?? 'https://pressline.0xff.sh',
  base,
  // No raster images on the site, so no sharp: assets pass through untouched.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: 'Pressline',
      description:
        'A self-hostable bridge from image-generating apps to print-on-demand: Printful fulfills, Stripe Checkout pays.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/dworznik/pressline' }],
      editLink: { baseUrl: 'https://github.com/dworznik/pressline/edit/main/apps/docs/' },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What Pressline is', slug: 'index' },
            { label: 'Try the demo', slug: 'try-the-demo' },
          ],
        },
        {
          label: 'Operator guide',
          items: [
            { label: 'Overview', slug: 'operator' },
            { label: 'Deploy', slug: 'operator/deploy' },
            { label: 'Configure', slug: 'operator/configure' },
            { label: 'Secrets and webhooks', slug: 'operator/secrets-and-webhooks' },
            { label: 'Go live', slug: 'operator/go-live' },
            { label: 'Demo Mode', slug: 'operator/demo-mode' },
            { label: 'Orders and reconciliation', slug: 'operator/orders' },
            { label: 'Legal wording and personal data', slug: 'operator/legal' },
          ],
        },
        {
          label: 'Engine developer guide',
          items: [
            { label: 'Overview', slug: 'engine' },
            { label: 'The protocol', slug: 'engine/protocol' },
            { label: 'Pre-rendering and hosting', slug: 'engine/hosting' },
            { label: 'Rendering with @pressline/render', slug: 'engine/render' },
            { label: 'Conformance suite', slug: 'engine/conformance' },
            { label: 'AI-assisted Engines', slug: 'engine/ai' },
          ],
        },
        {
          label: 'Print preparation',
          items: [
            { label: 'Overview', slug: 'print' },
            { label: 'Files, DPI, color, transparency', slug: 'print/files' },
            { label: 'Print areas and product limits', slug: 'print/products' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Overview', slug: 'reference' },
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'JSON API (OpenAPI)', slug: 'reference/api' },
            { label: 'Configuration', slug: 'reference/config' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', slug: 'architecture/overview' },
            { label: 'Landscape', slug: 'architecture/landscape' },
            { label: 'Containers', slug: 'architecture/containers' },
            { label: 'Effect service layer', slug: 'architecture/service-layer' },
            { label: 'Order flow', slug: 'architecture/order-flow' },
            { label: 'Reconciliation', slug: 'architecture/reconciliation' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Overview', slug: 'contributing' },
            { label: 'Effect primer', slug: 'contributing/effect' },
            { label: 'Test seams and fixtures', slug: 'contributing/testing' },
            { label: 'Licenses', slug: 'contributing/licenses' },
          ],
        },
      ],
    }),
  ],
})
