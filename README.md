# Pressline

Self-hostable, open-source bridge from an image-generating app to physical print-on-demand products. Printful fulfills, Stripe Checkout takes payment, no Shopify in between.

- Docs: https://pressline.0xff.sh/ · Demo instance: https://pressline-demo.vercel.app (the bridge, Demo Mode) with https://pressline-store-demo.vercel.app (the sample Engine)
- Glossary: [`CONTEXT.md`](./CONTEXT.md) · Decisions: [`docs/adr/`](./docs/adr) · Architecture: [C4 views](https://pressline.0xff.sh/architecture/overview/) ([landscape](https://pressline.0xff.sh/architecture/#/view/landscape/)) from [`docs/architecture/`](./docs/architecture) · Spec: [`docs/SPEC.md`](./docs/SPEC.md) · Tickets: [#1](https://github.com/dworznik/pressline/issues/1)

## Layout

```
apps/pressline        the bridge (SvelteKit + Effect), deployable to Cloudflare or Vercel
apps/sample-engine    reference Engine implementing DesignSource
apps/docs             the docs site (Astro Starlight)
packages/contract     @pressline/contract — DesignSource schemas, Printfile Spec, Spec Hash
packages/render       @pressline/render — printfile preparation helper for Engines
packages/cli          @pressline/cli — operator CLI
packages/conformance  @pressline/conformance — DesignSource conformance suite
deploy/               one-click templates for Cloudflare and Vercel
```

## Develop

```
pnpm install          # also wires git hooks
pnpm verify           # format · lint · typecheck · adr · architecture · test · build
```

License: MIT for code, CC BY 4.0 for docs.
