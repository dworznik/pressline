---
status: accepted
---

# Printfile artifacts come in levels; v1 is level 1, and the Spec Hash covers only the level-1 core

An Engine must be able to deliver the best print quality a provider can take without knowing which provider it is, and Printful (like others) accepts more than a flat raster: SVG, several layers per placement, positioning inside the print area, thread colors for embroidery. We decided that the DesignSource protocol describes Printfiles in **levels**, that **v1 is level 1 only**, and that the **Spec Hash is computed over the level-1 core and nothing else**, so richer levels can be added later without re-keying every Printfile ever rendered.

**Level 1** (the whole of v1): one raster file, PNG or JPEG, covering the entire print area at exactly the Spec's pixel size and DPI, sRGB, 8 bits per channel, alpha per the Spec's rule, transparent margins where the design does not reach. Every provider Pressline could plausibly support takes this; the reference Engine and the conformance suite implement exactly this.

**Later levels** (not in v1, named here so the vocabulary is settled): level 2, a raster at any density within a stated range with the exact aspect; level 3, a constrained SVG (text outlined, no external references, scripts or filters, a size cap); level 4, technique constraints such as a thread-count limit and palette for embroidery; level 5, a placement box inside the print area and several layers per placement. Physical-unit layout vocabulary is borrowed from PDF/X (trim, bleed, safe area). PDF itself is not an artifact format: providers warn against it and the bridge could not validate it without decoding (ADR-0002).

**The hash rule.** The level-1 core is `width`, `height`, `dpi`, `formats` (level-1 raster formats only), `colorSpace`, `alpha`, `placement`, `technique`. `canonicalize` serializes exactly these; any field a later level adds to the Spec is a **capability** (what the Engine _may_ deliver), is optional, and is excluded from the canonical form. A change to what level 1 _requires_ is a new protocol version, not a new field. Consequently, when a provider starts accepting SVG for a placement, or an Operator turns a capability on, every stored Printfile keeps its key and stays valid.

## Considered options

- A richer artifact format now (SVG, PDF/X-4, positioning) (rejected for v1: no provider is asked for it yet, the bridge cannot validate PDF without decoding, and the reference Engine would stop being small).
- Keep hashing every Spec field (rejected: the first optional capability field would change every hash and force every design to re-render, a silent, fleet-wide invalidation).
- A version tag inside the canonical form today (rejected: it would change every current hash for no gain; a tag is added the day the core itself changes, which is when a re-key is wanted).

## Consequences

- `canonicalize` must keep hashing exactly the eight core fields; a test in `@pressline/contract` pins that set so adding a Spec field fails until its author decides where it belongs.
- Any new Spec field is optional, so level-1 Engines keep working unchanged; the conformance suite gains a suite per level, and level 1 stays mandatory.
- Engines never see provider names or provider option keys; adapters map capabilities to the provider (e.g. a thread palette to Printful's `thread_colors`).
- Provider mockup generation and file libraries stay out of the Engine contract (ADR-0015); a mockup is a Preview the Engine may supply, never an input to printing.
