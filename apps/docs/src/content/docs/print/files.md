---
title: Files, DPI, color, transparency
description: What Printful wants, and how Pressline checks it.
---

- **Format**: PNG for anything with transparency (DTG, DTF, embroidery placements, UV); PNG or JPEG for all-over and sublimation where the Spec forbids alpha. `formats` in the Spec lists what a placement accepts.
- **Size**: the placement's print area in inches × its DPI, rounded to pixels: a 12×16 in DTG front at 150 dpi is 1800×2400 px. The Spec states the exact pixels; Pressline rejects anything else.
- **DPI**: stamped in the PNG's `pHYs`; providers read pixels first, but the stamp keeps preview tools honest.
- **Color**: sRGB, 8 bits per channel. Declare it (`sRGB` + `gAMA` chunks) and do not embed other profiles. Expect DTG prints darker and less saturated than a screen; avoid relying on pure neon.
- **Transparency**: `alpha: "allowed"` — transparent pixels print nothing (garment shows through); `forbidden` — the file must be opaque (flatten onto the product color or white); `required` — reserved in the Spec for placements that need transparency; Pressline's Printful catalog derivation today produces only `allowed` (DTG, DTF, embroidery, UV) and `forbidden`.
- **Bleed**: none for DTG/DTF placements. For all-over and sublimation products check Printful's placement documentation for whether the print area includes bleed; Pressline passes the provider's dimensions through unchanged.
- **Color type**: Pressline reads the PNG header, the first 64 KiB: color type 4/6 or a `tRNS` chunk means alpha, and reaching `IDAT` without one means none. If the chunk table runs past 64 KiB before `IDAT`, Pressline cannot tell either way and a placement whose Spec is `forbidden` or `required` rejects the file. Keep ancillary chunks (`iCCP`, `eXIf`, text) small enough that `IDAT` starts inside that window.
