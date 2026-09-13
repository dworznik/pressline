# Printfile requirements audit: Printful

Audited 2026-09-13 against Printful's own documentation, for ticket #108 (part
of the Wayfinder map #107, which rewrites #87). The prompt for it was that
`print/files.md`, the Engine hosting page and `validatePrintfile` each state a
different set of requirements, and none of them says which came from Printful.

**How to read.** Each table is one requirement, what our code does with it, and
what proves it. The tables are in two halves that must not be blurred:

- **Refuses** — Printful's own documentation says the file is rejected: the
  upload fails, the file's processing status becomes `failed`, or the placement
  comes back `failed`. A hard gate.
- **Recommends** — Printful's designer-facing guidance advises it. Not a gate.
  The file is accepted and printed; the advice is about whether the print comes
  out right.

Between those two sits a third thing Printful documents and we do not model at
all: the file is neither refused nor printed as sent, but **altered or held**.
It has its own section.

"Gap" links a ticket. A row with no gap is a claim we checked and found sound;
those are worth as much as the failures, because they are the ones nobody needs
to look at again.

**Confidence.** Every Printful claim here is linked to the Printful page it came
from. Where their documentation is silent the row says **undocumented**, and the
whole of what they are silent about is collected in its own section, because
that list — not this one — is what decides #114. Nothing here was probed against
the live API, so unlike the lifecycle audit there are **no empirical rows at
all**: every statement is either documentation or marked undocumented. Help
Center articles are quoted through Printful's own content API, because the HTML
is behind a bot challenge; the `help.printful.com` link on each row is the same
article.

**Our handling** throughout is today's `validatePrintfile`
(`packages/contract/src/validate.ts`). It reads exactly six things: the Spec
Hash the Engine echoed, the declared and served content type, the container
format, the exact pixel dimensions, the alpha channel (PNG color type 4/6 or a
`tRNS` chunk), and the declared byte count. It reads nothing else — not bit
depth, not `sRGB`/`gAMA`, not `iCCP`, not `pHYs`, not the JPEG color transform.
Everything else below is a gap by construction.

## Sources

- [API v2 (beta) reference](https://developers.printful.com/docs/v2-beta/) —
  Files v2, Orders v2, Catalog v2. The order path we use.
- [API v1 reference](https://developers.printful.com/docs/) — still the only
  place several file facts are written down at all.
- Help Center, Printful's own: the
  [file preparation article](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results),
  [RGB or CMYK](https://help.printful.com/hc/en-us/articles/28491774495772-Should-I-use-RGB-or-CMYK-for-Printful-print-files),
  [Smart Image Tool](https://help.printful.com/hc/en-us/articles/360014069659-How-does-the-Smart-Image-Tool-work),
  [technique disclaimers](https://help.printful.com/hc/en-us/articles/21140050579740-Disclaimers-for-Printing-Techniques),
  [embroidery digitization](https://help.printful.com/hc/en-us/articles/26233194163996-What-is-embroidery-digitization),
  [why an order is on hold](https://help.printful.com/hc/en-us/articles/360014009060-Why-is-my-order-on-hold).
- Printful's design guides:
  [DTG](https://www.printful.com/creating-dtg-file),
  [wall art](https://www.printful.com/create-digital-print-file),
  [all-over print](https://www.printful.com/creating-aop-file),
  [embroidery](https://www.printful.com/creating-embroidery-file),
  [UV](https://www.printful.com/creating-uv-design),
  [graphics and embroidery](https://www.printful.com/graphics-and-embroidery-guide).

Nothing here rests on a forum post, a reseller blog or a third-party guide.
Where that was the only evidence, the claim is listed as undocumented instead.

## What Printful refuses

There are more gates than #87 assumes, and **not one of them is about a pixel
format property**. Every documented refusal is about the envelope — can the file
be fetched, is it an image at all, is it too big, is the design empty.

| Printful says                                                                                                                                                                                                                                                                                                                      | Our handling                                                                                                                                            | Proof                                                          | Gap  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---- |
| The file must be **downloadable**. `order_failed` fires "if printfiles can not be downloaded, are not valid image files or when there is a payment failure" ([v2, Webhook v2](https://developers.printful.com/docs/v2-beta/))                                                                                                      | We fetch the Printfile URL before any Stripe session (ADR-0004) and fail `unreachable` or `status`                                                      | `printfile.test.ts`, "rejects: unreachable", "rejects: status" | —    |
| The file must be "**a valid image file**": a file's status goes to `ok` "if the file was loaded successfully and was a valid image file" or `failed` if not ([v2, Files v2](https://developers.printful.com/docs/v2-beta/))                                                                                                        | We parse a PNG or JPEG header from the first 64 KB and fail `header` if there is not one                                                                | `printfile.test.ts`, "rejects: header"                         | —    |
| **What "a valid image file" means is never defined.** No accepted-format list, no color requirement and no per-technique gate appears anywhere in either API reference                                                                                                                                                             | We require PNG or JPEG, which is narrower than whatever Printful accepts                                                                                | `spec.ts` — `PrintfileFormat` is `png \| jpeg`                 | #114 |
| v1 publishes **nine file error codes**: `FL-1 INVALID_FILE_FORMAT` ("returns a file with an invalid format"), `FL-7 INVALID_FILE_DATA` ("doesn't contain valid image data"), `FL-2 INVALID_FILE_URL`, plus `OR-10 UNSUPPORTED_FILE_TYPE` ([v1, Errors](https://developers.printful.com/docs/))                                     | Not consumed: we never touch the Files API, and v2's order path answers the legacy error body without file-specific types                               | `printful.ts` — `ErrorWire`                                    | —    |
| **Not one of those codes maps to a file property.** "Invalid format" and "not valid image data" are the whole taxonomy, and **v2 documents no file-specific error type at all**                                                                                                                                                    | Nothing to consume                                                                                                                                      | —                                                              | #114 |
| **Up to 200 MB, and at most 20 000 × 20 000 px.** "If you try to upload a file that doesn't meet these requirements, a warning or error message will appear and **the upload will fail**" ([file preparation](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results)) | **Nothing.** We check only that the served byte count matches what the Engine declared. A Spec is far below both ceilings today, but neither is checked | `printfile.test.ts`, "rejects: content_length"                 | #110 |
| A file name with **two dots before the extension** ("filename..png") "will also result in a failed upload" ([file preparation](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results))                                                                                | Not checked. Our Printfile URLs are content-addressed by design id and Spec Hash (ADR-0003), so the shape is ours, not an Engine's free choice          | `ensure.ts`                                                    | #110 |
| `.ai`, `.psd` and `.tiff` "**has been deprecated**, if your application uses these file types … you will need to add validation" ([v2, `AddFile.url`](https://developers.printful.com/docs/v2-beta/))                                                                                                                              | Irrelevant: the Spec never offers those formats                                                                                                         | —                                                              | —    |
| **Embroidery stitch files are refused**: "we don't accept stitch files like DST, PES, or EXP … please upload a standard image file, and we'll digitize it for embroidery" ([digitization](https://help.printful.com/hc/en-us/articles/26233194163996-What-is-embroidery-digitization))                                             | Irrelevant: `formats` is PNG for embroidery placements                                                                                                  | `catalog.ts` → `deriveSpec`                                    | —    |
| A placement can come back `status: "failed"` with a `status_explanation`; their example is "Product with ID: 656 cannot have disjointed design elements" ([v2, `Placement`](https://developers.printful.com/docs/v2-beta/))                                                                                                        | Read and surfaced: the adapter maps a failed placement onto the Order, and a post-confirmation `failed` becomes `on_hold` (#84)                         | `printful-adapter.test.ts`                                     | —    |
| A layer position with `limit_to_print_area: true` that crosses the print area is a **400** with "Invalid position" ([v1, Orders API](https://developers.printful.com/docs/))                                                                                                                                                       | Cannot arise: we send no `position`, and v2 says "If the positions are not provided then the design will be automatically centered"                     | `printful.ts` — `layers: [{ type: 'file', url }]`              | —    |
| A design that resolves to nothing is a **blank product**: "White prints on white fabric, designs placed outside the print area, tiny designs (under 10 px) … will count as blank products" ([graphics guide](https://www.printful.com/graphics-and-embroidery-guide))                                                              | Not checked. A Spec is never under 10 px, but an all-white or fully transparent Printfile would pass Validation and reach Printful                      | —                                                              | #110 |
| A file that turns out invalid **after** confirmation reverts the order: "the order is reverted to a failed state and needs to be corrected and confirmed again" ([v2, Files v2](https://developers.printful.com/docs/v2-beta/))                                                                                                    | Handled by #84's mapping. This is the failure the whole of #87 exists to make rarer, because by then the Customer has paid                              | `order-lifecycle.md` → Drafts, confirmation and cancellation   | —    |

### Size and dimensions

The pixel size Printful publishes per placement is a **floor at a stated DPI**,
not an exact requirement. We treat it as exact, which is stricter and safe.

| Printful says                                                                                                                                                                                                                                                      | Our handling                                                                                                                                                                     | Proof                                      | Gap |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --- |
| "a 10×10 poster requires a 1500×1500 pixel print file to produce a 150 DPI print. **You can use higher resolution files to achieve a better result**, but keep the side aspect ratio the same" ([v1, Mockup Generator API](https://developers.printful.com/docs/)) | We require the **exact** pixel size and reject anything else — deliberately, because the Spec Hash is a contract with the Engine (ADR-0005), not a guess at Printful's tolerance | `printfile.test.ts`, "rejects: dimensions" | —   |
| A wrong **aspect ratio** is cropped or fitted per the print file's `fill_mode` ("fit" or "cover"); it is not refused ([v1, Mockup Generator API](https://developers.printful.com/docs/))                                                                           | Cannot arise: the exact-size rule implies the exact ratio                                                                                                                        | `printfile.test.ts`, "rejects: dimensions" | —   |
| "Print file image file size limit: **50MB**" — stated once, in the **Mockup Generator** section, about mockup generation ([v1](https://developers.printful.com/docs/)). This is the second of two different size numbers Printful publishes                        | Not checked, and not the limit that binds our path                                                                                                                               | —                                          | —   |
| A layer is at least **0.3 inches** wide and high ([v2, `LayerPosition`](https://developers.printful.com/docs/v2-beta/))                                                                                                                                            | Cannot arise: no position is sent, so the design fills the placement                                                                                                             | —                                          | —   |

### DPI, and whether Printful reads a DPI stamp

Printful publishes **two different DPIs** and never says how the second one is
obtained. Keeping them apart is the whole of this section.

| Printful says                                                                                                                                                                                                                                                                                                                                                                                                                                 | Our handling                                                                                                                                         | Proof                                                   | Gap  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---- |
| The **placement's** DPI is derived from geometry: "`dpi` For given width and height, this is the resulting DPI on the actual product" ([v1, Mockup Generator API](https://developers.printful.com/docs/)), and `MockupStyles.dpi` is "Print area DPI" ([v2](https://developers.printful.com/docs/v2-beta/))                                                                                                                                   | We take that per-placement `dpi` from `/v2/catalog-products/{id}/mockup-styles` and multiply it by the print area in inches to get the Spec's pixels | `catalog.ts` → `deriveSpec`; `printful-adapter.test.ts` | —    |
| The **file's** DPI is something Printful reads back off the file: `File.dpi` is `readOnly`, filled in only after processing, and "for vector files this may be indicated as only 72dpi" ([v2, `File`](https://developers.printful.com/docs/v2-beta/))                                                                                                                                                                                         | Unused: we never read a file back out of the File Library                                                                                            | —                                                       | —    |
| **How `File.dpi` is obtained is undocumented.** `pHYs`, JFIF density, EXIF and the word "metadata" appear nowhere in either API reference, the Help Center, or any design guide                                                                                                                                                                                                                                                               | We do not read `pHYs` either. `@pressline/render` writes it and `print/files.md` tells Engines to stamp it                                           | `png.ts` writes `pHYs`; nothing reads it                | #87  |
| Two hints point at an embedded stamp being read. A vector file has no pixel count to divide, yet reports "only 72dpi". And: "Save for Web … **often reduces your file to 72 DPI**, which can result in a grainy print" ([file preparation](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results)) — an export mode that changes the density tag without changing a single pixel | Nothing                                                                                                                                              | —                                                       | #110 |
| One hint points the other way: "Make sure the file is sized to match the actual print dimensions **to ensure DPI is calculated correctly**" ([file preparation](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results))                                                                                                                                                          | Our Printfiles are exactly the placement's pixel count, so they satisfy this reading by construction                                                 | `catalog.ts` → `deriveSpec`                             | —    |
| v1 exposes one machine-readable DPI floor, and labels it advice: `min_dpi`, "**Recommended** minimum DPI for given product" — 75 on one product, 150 on another ([v1, `ProductTemplate`](https://developers.printful.com/docs/))                                                                                                                                                                                                              | Not read. We use v2's `mockup-styles`, which has no equivalent field                                                                                 | `printful.ts` — `MockupStyleWire`                       | #110 |

Correcting what #87 assumes, in both directions. A `pHYs` that disagrees with
the Spec's DPI is **not** provably harmless — Printful's own "Save for Web drops
you to 72 DPI" warning only makes sense if something reads the stamp. But
neither is it provably a rejection: Printful never names the chunk and publishes
no consequence. The honest position is that the mechanism is undocumented, which
makes a mismatch a Deviation, not a rejection, and makes writing the stamp
correctly worth more than #87 credits it for.

## What Printful recommends

None of this is a gate. Each item comes from a page Printful wrote, and each
describes the print looking wrong rather than the file being refused.

| Printful says                                                                                                                                                                                                                                                                                                                                                                           | Our handling                                                                                                                                                   | Proof                                               | Gap  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---- |
| "Create and export your print file in the **sRGB IEC61966-2.1** color profile. This is the color profile Printful recommends … Our printing system is optimized for sRGB files and converts colors for the printing process" ([file preparation](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results))                   | The Spec's `colorSpace` is the literal `'srgb'` and is covered by the Spec Hash, so the Engine has agreed to it. The validator never checks the file honors it | `spec.ts` — `colorSpace: Schema.Literal('srgb')`    | #87  |
| **Against CMYK**: "Converting your files to CMYK before uploading can unnecessarily reduce the available color information and lead to less accurate results"; "Use CMYK only to preview" ([RGB or CMYK](https://help.printful.com/hc/en-us/articles/28491774495772-Should-I-use-RGB-or-CMYK-for-Printful-print-files))                                                                 | Nothing. A CMYK JPEG passes Validation today                                                                                                                   | —                                                   | #87  |
| **Against other RGB spaces**: "avoid using files created in RGB color spaces other than sRGB, such as **Adobe RGB or ProPhoto RGB**, as these wider color spaces can cause unexpected color shifts" ([RGB or CMYK](https://help.printful.com/hc/en-us/articles/28491774495772-Should-I-use-RGB-or-CMYK-for-Printful-print-files))                                                       | Nothing. A file with an Adobe RGB `iCCP` passes Validation today                                                                                               | —                                                   | #87  |
| **For an embedded profile**, not against one: "modern professional printing workflows are optimized for RGB files **with an embedded sRGB color profile**"; "it's still a good idea to confirm that your file is exported with the sRGB profile embedded" ([RGB or CMYK](https://help.printful.com/hc/en-us/articles/28491774495772-Should-I-use-RGB-or-CMYK-for-Printful-print-files)) | Nothing — and this is the row that changes a decision. See the callout below                                                                                   | —                                                   | #110 |
| "For most Printful products, your print file **has to be at least 150 DPI** … Other Printful products, like phone cases and stickers, require 300 DPI. It's also **best not to exceed 300 DPI**" ([DTG guide](https://www.printful.com/creating-dtg-file))                                                                                                                              | The Spec's DPI is Printful's own per-placement value, so the pixel count is theirs. We never police a ceiling                                                  | `catalog.ts` → `deriveSpec`                         | —    |
| "Although the **minimum accepted DPI for paper products is 75**, we strongly recommend the files be at 300 DPI" ([wall art guide](https://www.printful.com/create-digital-print-file)); and elsewhere "**All files must be at least 300 DPI for paper prints and 150 DPI for everything else**" ([graphics guide](https://www.printful.com/graphics-and-embroidery-guide))              | Same. Printful's own pages disagree on the floor by a factor of four, which is itself the finding                                                              | —                                                   | —    |
| "we suggest using a transparent background and **saving your file as a PNG**. JPG files don't support transparent backgrounds, which means your design might be printed with a white background" ([DTG guide](https://www.printful.com/creating-dtg-file))                                                                                                                              | `formats` is PNG alone wherever alpha is allowed or required, enforced by a schema filter                                                                      | `spec.ts` — the `formats must include "png"` filter | —    |
| **Against semi-transparency**: "Avoid semi-transparent edges or fades for DTG/DTF printing"; shadows, fades, glow and low-opacity textures "may not print the way they appear on screen" ([file preparation](https://help.printful.com/hc/en-us/articles/28491464259740-How-should-I-prepare-my-print-file-for-the-best-results))                                                       | Nothing. We model alpha as present-or-absent, which is all a header read can see anyway                                                                        | `validate.ts` — `hasAlpha`                          | #109 |
| Per-product numbers live "on its product catalog page under the **File guidelines tab**" — every guide defers to it ([embroidery guide](https://www.printful.com/creating-embroidery-file))                                                                                                                                                                                             | Unreachable: that tab is rendered client-side on the storefront and is exposed by no API endpoint. Neither Pressline nor an Engine can read it                 | —                                                   | #114 |

### The callout: `iCCP` is not the enemy #87 thought it was

#87 proposes to "reject any `iCCP` and ask Engines to strip it". Printful asks
for the opposite — a file **exported with the sRGB profile embedded**. An
`iCCP` chunk carrying sRGB IEC61966-2.1 is Printful's recommended output, and a
rule that rejects every `iCCP` would reject it. What Printful actually advises
against is a profile that is **not** sRGB (Adobe RGB, ProPhoto RGB), and CMYK as
an upload color model. Whatever #110 decides, the discriminator has to be the
profile's identity, not the chunk's presence — which is a much harder thing to
see in 64 KB, and is exactly the question #109 is for.

## What Printful does instead of refusing

The map lists three provider behaviors: refuses the file, accepts and prints it
wrong, accepts and prints it right. Printful documents **two more**, and both
sit between the first two.

| Printful says                                                                                                                                                                                                                                                                                                                                                                                                                            | Our handling                                                                                                                                                                                          | Gap  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **It silently upscales a low-resolution file.** "You don't need to activate anything - the Smart Image Tool works automatically … It doubles the DPI of low-resolution images. For regular products, it works with images between **38 and 74 DPI**. For paper products, … **75 and 149 DPI**" ([Smart Image Tool](https://help.printful.com/hc/en-us/articles/360014069659-How-does-the-Smart-Image-Tool-work))                         | Cannot arise: our Printfiles are exactly the placement's pixel count, so they are already at Printful's stated DPI                                                                                    | —    |
| **It holds the order and emails the Operator.** Holds happen for "Print file problems, such as low resolution or content that doesn't meet our guidelines", and "Orders on hold for more than 30 days are automatically canceled and refunded" ([order on hold](https://help.printful.com/hc/en-us/articles/360014009060-Why-is-my-order-on-hold))                                                                                       | `on_hold` plus an Alarm. The 30-day clock and the reason are the substance of #99                                                                                                                     | #99  |
| **For embroidery, it rewrites the design and asks for approval**: "we may need to: thicken thin lines / simplify small details / resize certain elements / adjust colors to supported thread options. **If adjustments are needed, you'll be asked to review and approve the updated version before production continues**" ([digitization](https://help.printful.com/hc/en-us/articles/26233194163996-What-is-embroidery-digitization)) | Not modeled. It arrives as an approval hold, which #99 records as unsubscribed (`order_put_hold_approval`, `approval_sheet_status_changed`)                                                           | #99  |
| **And it can fail that rewrite**: "If the design doesn't meet embroidery requirements and can't be adjusted for production, **digitization may fail** … you'll need to update your artwork and resubmit it" ([digitization](https://help.printful.com/hc/en-us/articles/26233194163996-What-is-embroidery-digitization))                                                                                                                 | A refusal that lands days after payment, on grounds (stitch geometry) no header read can anticipate. It is the strongest case in this audit for the Operator-facing forensic record #111 is designing | #111 |

The consequence for the map is small but real: a Deviation is not only "Printful
might print this wrong". It can also be "Printful will quietly change this", and
the Operator has no other way to learn that it happened.

## By technique and placement

Geometry and DPI **do** vary by technique, and that much is API-discoverable:
Printful's own worked example returns, for one product (162), `1800×2400` at 150
DPI on the DTG placements and `1200×1200` at 300 DPI on the embroidery ones
([v1, Mockup Generator API examples](https://developers.printful.com/docs/)).
`deriveSpec` keys the Spec on `(placement, technique)` for exactly this reason.

Everything else is prose. Printful publishes **no per-technique file gate in the
API at all** — the catalog exposes `placement`, `technique`, `print_area_width`,
`print_area_height`, `print_area_type` and `dpi`, and nothing else about the
file ([v2, `MockupStyles`](https://developers.printful.com/docs/v2-beta/)).

| Technique          | What Printful documents about the file                                                                                                                                                                                                                                                                                                                                           | Our handling                                         | Gap  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---- |
| DTG                | The fullest guide: PNG with transparency, sRGB IEC61966-2.1, at least 150 DPI, not above 300. "We do not print white ink on white garments"                                                                                                                                                                                                                                      | `alpha: 'allowed'`, PNG only, Spec DPI from Printful | —    |
| DTF (`dtfilm`)     | **300 DPI**, not 150. Lines at least 1 pt, "approximately 4 px at 300 DPI"; avoid soft edges ([disclaimers](https://help.printful.com/hc/en-us/articles/21140050579740-Disclaimers-for-Printing-Techniques))                                                                                                                                                                     | `alpha: 'allowed'`, PNG only, Spec DPI from Printful | —    |
| All-over / cut-sew | Two Printful voices. The [AOP guide](https://www.printful.com/creating-aop-file) recommends a transparent PNG for partial coverage; the [disclaimers](https://help.printful.com/hc/en-us/articles/21140050579740-Disclaimers-for-Printing-Techniques) say "The color white can't be printed on all-over print products … **We suggest not using white or transparent elements**" | `alpha: 'forbidden'` — the conservative of the two   | —    |
| Sublimation        | Covered only by the AOP pages, which treat AOP and cut & sew as the same thing                                                                                                                                                                                                                                                                                                   | `alpha: 'forbidden'`                                 | —    |
| Embroidery         | PNG with a transparent background, no DPI or color statement. The file is **digitized by hand**, and small elements "may be enlarged, converted to run-stitch, or removed"                                                                                                                                                                                                       | `alpha: 'allowed'`, PNG only                         | —    |
| UV                 | The [UV guide](https://www.printful.com/creating-uv-design) states **nothing** about the file: no format, no DPI, no color. Phone cases: "Keep your design elements at either 0% or 100% transparency"                                                                                                                                                                           | `alpha: 'allowed'`, PNG only                         | #114 |
| Engraving          | A v1 mockup technique (`ENGRAVING`); no file guidance was found on any Printful page                                                                                                                                                                                                                                                                                             | No Offer configures it; it would derive `forbidden`  | —    |

`print_area_type` deserves one line: it is `simple` or `advanced`, and
`advanced` means "both sides of the product will be designed"
([v2, `Placement`](https://developers.printful.com/docs/v2-beta/)). Every Offer
Pressline derives is `simple`, and a Level 1 Printfile cannot express an
advanced one — which is what `Printfile Level` in `CONTEXT.md` already reserves.

## What Printful does not document

This is the list that decides #114. Each was searched for across the full v1 and
v2 OpenAPI documents, Printful's Help Center and all six design guides, and is
absent.

| Question                                                                                                                                           | Status           | Why it matters                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bit depth.** Is a 16-bit PNG accepted? Printed correctly?                                                                                        | **undocumented** | "bit depth", "8-bit" and "16-bit" appear nowhere: not in the API, not in the Help Center, not in a guide                                                                    |
| **Interlaced PNG, progressive JPEG**                                                                                                               | **undocumented** | Neither word appears anywhere                                                                                                                                               |
| **`sRGB` and `gAMA` chunks.** Does declaring the color space change anything?                                                                      | **undocumented** | Printful names an ICC profile, never a PNG chunk. Whether an unlabeled file is assumed sRGB is unsaid                                                                       |
| **What actually happens to a non-sRGB or CMYK file**                                                                                               | **undocumented** | They advise against both and never say whether the file is converted, flagged, held, or printed as-is                                                                       |
| **How `File.dpi` is obtained**                                                                                                                     | **undocumented** | `pHYs`, JFIF density, EXIF and "metadata" are never mentioned, and their own hints contradict each other (see above)                                                        |
| **Alpha semantics**: premultiplied alpha, and what a partial alpha value becomes per technique                                                     | **undocumented** | The advice is qualitative ("may not print the way they appear"); there is no threshold and no rule                                                                          |
| **Which size limit binds the order path**                                                                                                          | **undocumented** | Three numbers exist — 200 MB and 20 000 px for the File library, 50 MB for the mockup generator — and none is tied to an order                                              |
| **A minimum pixel dimension**                                                                                                                      | **undocumented** | Only the blank-product rule, "tiny designs (under 10 px)", comes close                                                                                                      |
| **Which file property produces which error**                                                                                                       | **undocumented** | v1's nine codes stop at "invalid format" and "not valid image data"; v2 names no file error at all, and one `status_explanation` example is the entire published vocabulary |
| **How Printful fetches a Printfile URL**: redirects, timeout, user agent, retries, whether HTTPS is required, whether it re-fetches at fulfillment | **undocumented** | Already open as question 6 in `order-lifecycle.md`. Their own file URL examples use plain `http://`                                                                         |
| **Whether file processing ever reports back**                                                                                                      | **undocumented** | There is no webhook for a file reaching `ok` or `failed`. An order can be confirmed while its file is still `waiting`                                                       |
| **Per-product file guidelines in machine-readable form**                                                                                           | **undocumented** | They exist, as a tab on the storefront product page, and no endpoint serves them                                                                                            |
| **Whether TIFF, SVG, WebP or GIF are accepted**                                                                                                    | **undocumented** | Only `.ai`, `.psd` and `.tiff` are named, as deprecated. PDF is "an accepted file format" on one Printful page and "Avoid using PDF format" on another                      |

A draft order can settle a row here only in one direction: it can prove
**refuses** or **does not refuse**. It cannot tell "accepts and prints it right"
from "accepts and prints it wrong", which is the expensive case and the one the
map already decided not to buy.

### What this does to the map's reject line

The map reserves rejection for what Printful "either refuses **or publishes
advice against (16-bit, non-sRGB `iCCP`, CMYK JPEG, interlaced)**". Held against
the sources, that list splits in half:

- **CMYK** and **non-sRGB profiles** — Printful does publish advice against
  both, in as many words. The stated ground holds.
- **16-bit** and **interlaced** — Printful publishes **nothing at all**, for or
  against. The stated ground does not exist, so rejecting them has to rest on
  the precautionary argument alone ("we cannot see what Printful does with it,
  and a wrong print costs more than a lost sale"), or they become Deviations.
  That is #110's to decide, and it should decide it knowing the advice it was
  counting on is not there.
- **`iCCP` itself** — the premise is inverted, per the callout above.

## Checked and found sound

- **We are stricter than Printful on size, deliberately.** Printful accepts any
  file at the right aspect ratio and treats the published pixel size as a
  150-DPI floor. We require it exactly, because the Spec Hash is a contract with
  the Engine (ADR-0005), not a guess at Printful's tolerance. Nothing is lost: a
  file that satisfies us always satisfies them.
- **Our content type check matches how Printful names a file.** Printful derives
  the extension "based on the media type of the file"
  ([v2, `AddFile.filename`](https://developers.printful.com/docs/v2-beta/)), so
  an Engine serving a PNG as `text/html` would confuse them too.
- **The 64 KB header window covers everything Printful documents.** Format,
  dimensions and alpha all sit in the first chunks. It is only the
  _undocumented_ properties — an `iCCP` profile above all — that can sit beyond
  it, which is the open question the map already records for #109.
- **Immutable Printfile URLs remain the right shape**, for the reason
  `order-lifecycle.md` gives: Printful keys the File Library on the URL and, on
  a repeat, "returns the old one without refreshing its contents".
- **Our `alpha: 'forbidden'` for all-over and sublimation is defensible.** It
  follows Printful's disclaimer rather than their AOP guide, and those two
  disagree; taking the stricter one costs an Engine a background fill and costs
  nobody a wrong print.

## Gaps

| #    | Gap                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #87  | The validator reads none of bit depth, color space, embedded profile or `pHYs`, and our docs say it does                               |
| #109 | Whether a 64 KB read can identify an `iCCP` profile, and what partial alpha can be seen at all                                         |
| #110 | The reject-or-Deviate decision per row, now that two of its four named cases have no published advice behind them                      |
| #114 | Whether a draft-order probe settles the undocumented rows — and it can only ever answer "refuses / does not refuse"                    |
| #111 | Embroidery digitization can fail days after payment, on grounds no header read can anticipate — the case a Deviation record exists for |
| #99  | Printful's "we changed your file, approve it" path is a provider behavior we neither subscribe to nor model                            |
