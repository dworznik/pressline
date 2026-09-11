# Branding

Everything the Customer sees carries your name; the rest is optional and lives in `pressline.config.ts`:

```ts
branding: {
  logoUrl: 'https://cdn.example/logo.svg', // header and emails; the name is used without it
  accent: '#0a7d5a',                        // buttons, links, progress; default #222222
  accentText: '#ffffff',                    // text on the accent
  tagline: 'Prints from your designs',
},
legal: { termsUrl, privacyUrl, contactEmail }, // footer links on every Storefront page
```

## What the Customer sees on the product

- If the Engine returns `mockups[offerSlug]` for a design, that image is shown as is (hot-linked, never stored) with the caption "Mockup from the design app".
- Otherwise the design's Preview is laid over the variant's `imageUrl` (your product photo, or Printful's) with the Placement's proportions and an "illustrative" caption. Placement and size are approximate: it is not a print proof.
- Without a product photo the Preview is shown alone.

Copy is English only in v1; every string lives in one module for a later localisation.
