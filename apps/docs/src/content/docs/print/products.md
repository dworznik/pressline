---
title: Print areas and product limits
description: Where the numbers come from, and what fits in a Worker.
---

Pressline asks Printful for each product's placements (print area, DPI, technique) and each variant's placement dimensions, derives one Printfile Spec per Offer variant, and caches it for a day. `pressline catalog search <text>` shows the Specs a product implies before you configure it.

**Limits** (Printful v2 open beta as of this writing): one placement per Offer in v1; technique per Offer; some variants have smaller print areas than the product's default (Pressline uses the variant's); embroidery placements need thread-count-friendly art and are best left out of an automated Engine.

## Worker-fit table

Raw RGBA bytes a render needs (source ≈ canvas, ×4 for source, scaled copy, canvas and encoding rows) against the WASM backend's default 64 MiB budget:

| Placement (typical)           | Spec      | Raw bytes | WASM                                                            |
| ----------------------------- | --------- | --------- | --------------------------------------------------------------- |
| DTG front, 12×16 in @ 150 dpi | 1800×2400 | 69 MB     | over by a little — raise the budget to 96 MiB or render on Node |
| DTG front, 12×16 in @ 300 dpi | 3600×4800 | 276 MB    | Node only                                                       |
| Poster 18×24 in @ 150 dpi     | 2700×3600 | 156 MB    | Node only                                                       |
| Mug wrap 8.6×3.5 in @ 300 dpi | 2580×1050 | 43 MB     | fits                                                            |
| Sticker 4×4 in @ 300 dpi      | 1200×1200 | 23 MB     | fits                                                            |

Rule of thumb: under ~2000×2000 renders in a Worker; larger belongs on Node (Vercel, a container) or is pre-rendered elsewhere and only served from the Worker.
