import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// pressline.dev (ticket #26): a static Starlight site. Deploy the `dist/`
// output anywhere static; both platforms' buttons work with framework "astro".
export default defineConfig({
  site: 'https://pressline.dev',
  integrations: [
    starlight({
      title: 'Pressline',
      description:
        'A self-hostable bridge from image-generating apps to print-on-demand: Printful fulfils, Stripe Checkout pays.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/dworznik/pressline' }],
      editLink: { baseUrl: 'https://github.com/dworznik/pressline/edit/main/apps/docs/' },
      sidebar: [
        { label: 'Start here', items: [{ label: 'What Pressline is', slug: 'index' }] },
        {
          label: 'Operator guide',
          items: [
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
            { label: 'Files, DPI, colour, transparency', slug: 'print/files' },
            { label: 'Print areas and product limits', slug: 'print/products' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'JSON API (OpenAPI)', slug: 'reference/api' },
            { label: 'Configuration', slug: 'reference/config' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Effect primer', slug: 'contributing/effect' },
            { label: 'Test seams and fixtures', slug: 'contributing/testing' },
            { label: 'Licences', slug: 'contributing/licences' },
          ],
        },
      ],
    }),
  ],
});
