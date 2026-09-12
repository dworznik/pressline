# The Pressline mark

One mark, "Screen": a 3×3 halftone cell of nine squares on a 64-unit grid,
falling in size along the diagonal. One flat fill; tone comes from dot size
only. No strokes, no gradients, no rounded corners, no container behind it, and
no text inside it.

## Where it appears

| Surface           | File                                                                      | Fill                                     |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| The bridge        | `apps/pressline/static/favicon.*`                                         | `#26262b`, `#f2f2f0` in dark             |
| The Operator View | the same files                                                            | the same                                 |
| Sample Engine     | `apps/sample-engine/static/favicon.svg`                                   | `#7a7a85` — same geometry, a quieter ink |
| Docs site         | `apps/docs/public/favicon.*`, header logo `apps/docs/src/assets/mark.svg` | `currentColor` in the header             |

The Storefront is the **Operator's** shop, so the mark there is only a default:
`branding.faviconUrl` overrides it, falling back to `branding.logoUrl`. The
Operator View is ours and always shows the mark.

## Rules

- **Never redraw it by hand.** `apps/docs/src/assets/mark.svg` is the canonical
  geometry with `fill="currentColor"`; regenerate any raster from it.
- **Below 20 px, the 64-grid source goes soft** — dots land on half pixels and
  the two smallest vanish. `favicon.ico` already carries a pixel-snapped 16 px
  bitmap for exactly this, which is why the `.ico` is still linked alongside the
  SVG rather than dropped.
- **Never add a second color inside the mark.**
- **Email must use PNG**, never SVG, at an absolute URL — many mail clients
  refuse SVG. Pressline ships no email logo today: the header falls back to the
  Operator's `logoUrl`, or to their shop name as text.

## Geometry (64 grid) — x, y, size

`3,3,18` · `25,5,14` · `5,25,14` · `47,7,10` · `27,27,10` · `7,47,10` ·
`49,29,6` · `29,49,6` · `51,51,2`

Cell pitch 22u; dot sizes 18 / 14 / 10 / 6 / 2 by diagonal index (row + col).
