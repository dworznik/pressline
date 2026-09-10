# Pressline

Self-hostable, open-source bridge from an image-generating app to physical print-on-demand products. Printful fulfils, Stripe Checkout takes payment, no Shopify in between.

- Project: pressline.dev · Demo: pressline.store
- Glossary: [`CONTEXT.md`](./CONTEXT.md) · Decisions: [`docs/adr/`](./docs/adr) · Spec: [`docs/SPEC.md`](./docs/SPEC.md) · Tickets: [#1](https://github.com/dworznik/pressline/issues/1)

## Layout

```
apps/pressline        the bridge (SvelteKit + Effect), deployable to Cloudflare or Vercel
apps/sample-engine    reference Engine implementing DesignSource
apps/docs             pressline.dev
packages/contract     @pressline/contract — DesignSource schemas, Printfile Spec, Spec Hash
packages/render       @pressline/render — printfile preparation helper for Engines
packages/cli          @pressline/cli — operator CLI
deploy/               one-click templates for Cloudflare and Vercel
```

## Develop

```
pnpm install          # also wires git hooks
pnpm verify           # format · lint · typecheck · adr · test · build
```

Licence: MIT for code, CC BY 4.0 for docs.
