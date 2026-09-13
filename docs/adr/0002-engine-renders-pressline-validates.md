---
status: accepted
---

# The Engine renders printfiles; Pressline only validates

Pressline must run on both Cloudflare Workers and Vercel, so any pixel work in core would have to be WASM and fit inside Worker CPU/memory limits; a full-size DTG printfile is ~100 MB of raw RGBA, which makes in-core resampling a production risk and would also make Pressline the owner of color-management and quality complaints. We therefore decided that the Engine produces the finished Printfile for a Printfile Spec that Pressline supplies, and Pressline validates it by inspecting headers only (format, dimensions, color type, size), returning precise errors (amended 2026-09-14: a header stored compressed is still a header. Validation may inflate a bounded prefix of a PNG `iCCP` chunk to read the ICC header's data color space signature at offset 16, bounded by the compressed bytes fed in rather than by the profile's claimed size, so a zip bomb cannot use it. It decodes no pixels, stores no image bytes and adds no dependency: `DecompressionStream` is a platform global on every target. It recovers `RGB`/`CMYK`/`GRAY` and nothing finer — telling sRGB from Adobe RGB would mean comparing a profile's colorants against a reference, which is the color-management judgment this ADR exists to refuse, so a non-sRGB profile is not something Pressline can ever claim to see). A separate optional helper package (`@pressline/render`) gives Engines a reference implementation of fit/pad/resample so they need not reinvent it; it never runs on Pressline's request path.

## Considered options

- Pressline renders from arbitrary artwork (rejected: Worker limits, ownership of quality).
- Engine renders with no helper (rejected: every Engine author re-solves DPI/bleed/transparency).

## Consequences

- Pressline must be able to state the exact Printfile Spec before the Engine renders, so the provider printfile lookup lives in Pressline.
- Core has no image-decoding dependency beyond header parsing.
