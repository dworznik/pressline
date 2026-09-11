---
title: Files, DPI, colour, transparency
description: What Printful wants, and how Pressline checks it.
---

- **Format**: PNG for anything with transparency (DTG, DTF, embroidery placements, UV); PNG or JPEG for all-over and sublimation where the Spec forbids alpha. `formats` in the Spec lists what a placement accepts.
- **Size**: the placement's print area in inches × its DPI, rounded to pixels: a 12×16 in DTG front at 150 dpi is 1800×2400 px. The Spec states the exact pixels; Pressline rejects anything else.
- **DPI**: stamped in the PNG's `pHYs`; providers read pixels first, but the stamp keeps preview tools honest.
- **Colour**: sRGB, 8 bits per channel. Declare it (`sRGB` + `gAMA` chunks) and do not embed other profiles. Expect DTG prints darker and less saturated than a screen; avoid relying on pure neon.
- **Transparency**: `alpha: "allowed"` — transparent pixels print nothing (garment shows through); `forbidden` — the file must be opaque (flatten onto the product colour or white); `required` — the placement needs transparency (e.g. a cut-out on embroidery).
- **Bleed**: none for DTG/DTF placements; all-over and sublimation Specs already include Printful's bleed in the print area.
- **Colour type**: Pressline reads the PNG header: colour type 4/6 or a `tRNS` chunk means alpha.
