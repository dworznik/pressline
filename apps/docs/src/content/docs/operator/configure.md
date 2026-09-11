---
title: Configure
description: The Catalogue, your Engines and your look live in one typed file.
---

Everything that is not a secret is in `apps/pressline/pressline.config.ts`, validated at boot. Edit, commit, redeploy; the Operator View never edits configuration.

```ts
export default defineConfig({
  name: 'My Shop',
  currency: 'EUR',
  engines: [{ slug: 'sample', baseUrl: 'https://engine.example' }],
  catalogue: {
    offers: [
      {
        slug: 'tee-black-front',
        name: 'Black tee, front print',
        catalogProductId: 71, // Printful catalog product
        placement: 'front',
        technique: 'dtg',
        retailPrice: 2500, // minor units, tax excluded
        variants: {
          'black-m': { catalogVariantId: 4017, label: 'Black / M', color: 'Black', size: 'M' },
        },
      },
    ],
  },
  branding: { logoUrl: 'https://cdn.example/logo.svg', accent: '#0a7d5a', accentText: '#ffffff' },
  legal: { termsUrl: '…', privacyUrl: '…', contactEmail: 'hello@example' },
  email: { from: 'My Shop <orders@example>', operator: 'me@example' },
  checkout: { publicUrl: 'https://shop.example' },
});
```

- **Offers** point at Printful catalog variants; `pressline catalogue search "staple"` prints a ready-made snippet with the variant IDs and the Printfile Spec each placement implies. `pressline catalogue check` verifies every Offer resolves.
- **Engines** are trusted apps you configure with a slug and base URL; each has its own shared secret `ENGINE_SECRET_<SLUG>` in the platform env.
- **Retail prices** are fixed per Offer; shipping is quoted live from Printful (optionally marked up with `shipping.markupPercent`); tax is Stripe's.
- The full schema is in the [configuration reference](/reference/config/).
