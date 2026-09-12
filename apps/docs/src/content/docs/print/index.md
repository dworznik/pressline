---
title: Print preparation
description: What the printer actually needs, and how Pressline checks it.
---

A print file is not a screen image. It has an exact pixel size, a physical size
it implies, a color space the printer can reproduce, and rules about
transparency that differ per printing technique. Get these wrong and the order
is rejected after payment, which is the worst moment to find out.

Pressline derives a **Printfile Spec** per product and placement from the
provider's own catalog, hands it to your Engine, and validates what comes back
before any payment is taken. These two pages explain what that Spec contains and
where its numbers come from.

- **[Files, DPI, color, transparency](/print/files/)** — format per technique,
  the exact pixel size and where it comes from, sRGB and why not to embed other
  profiles, what each transparency rule means, and bleed.
- **[Print areas and product limits](/print/products/)** — how a product's
  placements become Specs, and which combinations are too large to render inside
  a Worker's memory budget.

The short version: for direct-to-garment printing, send a PNG at exactly the
Spec's pixel size, sRGB at 8 bits per channel, with transparency where you want
the garment to show through.
