---
status: accepted
---

# The Engine renders printfiles; Pressline only validates

Pressline must run on both Cloudflare Workers and Vercel, so any pixel work in core would have to be WASM and fit inside Worker CPU/memory limits; a full-size DTG printfile is ~100 MB of raw RGBA, which makes in-core resampling a production risk and would also make Pressline the owner of colour-management and quality complaints. We therefore decided that the Engine produces the finished Printfile for a Printfile Spec that Pressline supplies, and Pressline validates it by inspecting headers only (format, dimensions, colour type, size), returning precise errors. A separate optional helper package (`@pressline/render`) gives Engines a reference implementation of fit/pad/resample so they need not reinvent it; it never runs on Pressline's request path.

## Considered options

- Pressline renders from arbitrary artwork (rejected: Worker limits, ownership of quality).
- Engine renders with no helper (rejected: every Engine author re-solves DPI/bleed/transparency).

## Consequences

- Pressline must be able to state the exact Printfile Spec before the Engine renders, so the provider printfile lookup lives in Pressline.
- Core has no image-decoding dependency beyond header parsing.
