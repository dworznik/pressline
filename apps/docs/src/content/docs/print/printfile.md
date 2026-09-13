---
title: The Printfile format in detail
description: Byte-level requirements for the file an Engine produces, what Pressline checks, and what Printful does with it.
---

This page is for Engine developers who write their own renderer instead of
using [`@pressline/render`](/engine/render/). It states exactly what a Printfile
must look like, which of those requirements Pressline enforces before payment,
and which ones Printful merely expects. If you use the helper, its output already
satisfies everything below; read this to know why.

The short version: an 8-bit sRGB PNG at exactly the Spec's pixel size, DPI
stamped, `IDAT` starting inside the first 64 KiB, transparent where the Spec
allows it and opaque where it forbids it. JPEG only where the Spec lists it.

## The Spec is the contract

Every render request carries a [Printfile Spec](/engine/protocol/). It is the
whole requirement, and you agree to it by echoing its Spec Hash:

| Field        | Example     | What it means for the file                                                                         |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------- |
| `width`      | `1800`      | Exact pixel width. Not a minimum.                                                                  |
| `height`     | `2400`      | Exact pixel height. Not a minimum.                                                                 |
| `dpi`        | `150`       | The density the provider prints at. Stamp it in the file; it is what makes `width` mean 12 inches. |
| `formats`    | `["png"]`   | The containers accepted. Always includes `png`; includes `jpeg` only when `alpha` is `forbidden`.  |
| `colorSpace` | `"srgb"`    | The only value. Pixels are sRGB, 8 bits per channel.                                               |
| `alpha`      | `"allowed"` | `allowed`, `forbidden` or `required`. See [transparency](#transparency-by-technique).              |
| `placement`  | `"front"`   | The provider's placement key. Informational for the renderer.                                      |
| `technique`  | `"dtg"`     | The provider's print technique. Decides the alpha rule and how the print behaves.                  |

Pressline derives the Spec from Printful's catalog: the placement's print area in
inches times its DPI, rounded to whole pixels. A 12 × 16 in DTG front at 150 dpi
is 1800 × 2400 px. [Print areas and product limits](/print/products/) explains
where the numbers come from.

## Container

Only PNG and JPEG exist in the protocol. Printful accepts a few more formats and
advises against others; none of that reaches you, because the Spec never lists
them.

- **PNG** is always accepted and is the right default. It is the only container
  that can carry transparency, and Printful's own guidance for garment printing
  asks for it.
- **JPEG** is accepted only where `formats` lists it, which today means
  placements whose Spec forbids alpha: paper, sublimation, all-over. Printful
  notes JPEG processes faster there. Quality is your call; below about 90 the
  artifacts print.

Pressline checks three things about the container, in this order:

1. The `contentType` you declare in the render response is in `formats`.
2. The `Content-Type` your host serves matches what you declared.
3. The file's own signature (the PNG signature or the JPEG `SOI` marker) matches
   both.

Any mismatch is a rejection before the pixels are looked at.

## PNG, byte by byte

Pressline reads the first 64 KiB of the file with one ranged GET and walks the
chunk table. It never inflates `IDAT` and never sees a pixel.

### Signature and IHDR

The 8-byte signature, then `IHDR`, which is always the first chunk and always 13
bytes long. Its fields, and what each must be:

| Byte offset | Field       | Requirement                                                                                    |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------- |
| 16          | Width       | Exactly `spec.width`.                                                                          |
| 20          | Height      | Exactly `spec.height`.                                                                         |
| 24          | Bit depth   | `8`. Not 16: Printful gains nothing from it and the file doubles. Not 1, 2 or 4.               |
| 25          | Color type  | `2` (RGB) or `6` (RGBA) for truecolor; `0`, `3` and `4` are accepted but rarely what you want. |
| 26          | Compression | `0`, the only defined value.                                                                   |
| 27          | Filter      | `0`, the only defined value.                                                                   |
| 28          | Interlace   | `0`. Adam7 interlacing (`1`) makes the file larger and slower for no benefit in print.         |

Color type decides transparency. Types `4` and `6` carry an alpha channel and
count as transparent, whatever the pixels hold. Types `0`, `2` and `3` are
opaque unless a `tRNS` chunk follows.

### Chunks before IDAT

The PNG specification requires every chunk Pressline or Printful cares about to
precede the first `IDAT`. Emit them in this order:

| Chunk  | Emit it        | Contents                                                                                                                                                                                |
| ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sRGB` | Yes, or `iCCP` | One byte, rendering intent `0` (perceptual). Declares the color space without a profile.                                                                                                |
| `iCCP` | Or `sRGB`      | An embedded **sRGB IEC61966-2.1** profile, which is what Printful asks for. Only that profile, and the small one: see [the 64 KiB window](#the-64-kib-window). Never CMYK or Adobe RGB. |
| `gAMA` | Yes            | `45455`, the sRGB gamma of 1/2.2 scaled by 100 000. Readers that ignore both chunks above still honor this.                                                                             |
| `pHYs` | Yes            | Pixels per meter, both axes, unit byte `1`. `round(dpi / 0.0254)`: 150 dpi is `5906`, 300 dpi is `11811`.                                                                               |
| `PLTE` | Only for `3`   | The palette. Indexed color is accepted but pointless for photographic prints.                                                                                                           |
| `tRNS` | Only for alpha | Transparency for color types `0`, `2` and `3`. Its presence alone counts as alpha. After `PLTE` if there is one.                                                                        |

The PNG specification says a file should carry `sRGB` **or** `iCCP`, not both;
a decoder that finds both is told to prefer the profile. `@pressline/render`
writes `sRGB`. Write `iCCP` instead if you want to follow Printful's
embedded-profile advice to the letter; Pressline accepts either today.

Do not emit `cHRM` with non-sRGB primaries, `eXIf` blocks with thumbnails, or
large `iTXt`, `zTXt` and `tEXt` blocks. They are legal, but they are the usual
reason `IDAT` slips out of the window below.

### The 64 KiB window

Pressline reads at most 64 KiB. Within that window it must find `IDAT`, because
reaching `IDAT` is what proves a file has **no** `tRNS`, and therefore no alpha.
If the chunk table runs past the window first, Pressline records the alpha as
**unseen**, and:

- a placement whose Spec is `forbidden` or `required` **rejects** the file, with
  a message that says so;
- a placement whose Spec is `allowed` accepts it.

That is a precaution, not a limitation you can argue with after payment: a
wrong print costs the Operator the goods, the shipping and the reprint. The fix
is always on your side and always the same: make `IDAT` start inside 64 KiB.
In practice only one thing pushes it out. The classic sRGB IEC61966-2.1 profile
is about 3 KB and fits with room to spare. The v4 "preference" sRGB profile is
about 60 KB, and even zlib-compressed inside `iCCP` it can put `IDAT` past
byte 65 536. Use the small one.

### What `@pressline/render` emits

For reference, the helper writes exactly this and nothing else:

```
signature
IHDR   8-bit, color type 6 (RGBA) when alpha is allowed or required, 2 (RGB) when forbidden, no interlace
sRGB   0
gAMA   45455
pHYs   spec.dpi as pixels per meter
IDAT   one chunk, filter 0 on every row
IEND
```

No `iCCP`, no text, no EXIF. The `IDAT` chunk begins at byte 83.

## JPEG, marker by marker

Allowed only where `formats` lists `jpeg`. Pressline reads the marker segments
up to the first frame header (`SOF0` baseline or `SOF2` progressive; either is
fine) and takes the dimensions from it. Requirements:

- **8-bit samples**, three components in YCbCr. Never CMYK or YCCK: Printful
  advises against CMYK files and its pipeline converts from RGB. An Adobe
  `APP14` segment with transform `2` is the tell.
- **Exact dimensions** in the frame header, as for PNG.
- **JFIF `APP0`** with density unit `1` (dots per inch) and `spec.dpi` in both
  axes, so the file states its physical size. Printful reads pixels first, but a
  preview tool that trusts the stamp will otherwise show the wrong size.
- **Keep the frame header inside 64 KiB.** A JPEG has no alpha, so there is no
  unseen case; but if `SOF` itself lies past the window, because an `APP1` EXIF
  block carries a thumbnail or an `APP2` ICC profile is large, Pressline cannot
  read the header at all and rejects the file as unreadable. Strip EXIF, and
  embed only the small sRGB profile if any.
- **No transparency exists in JPEG.** That is why the Spec only lists it where
  alpha is forbidden.

Chroma subsampling `4:4:4` keeps text and hard edges clean; `4:2:0` is fine for
photographs. Quality 90 or above.

## Size and DPI

- The pixel size is exact. Larger is rejected; there is no "at least". Do not
  add bleed to DTG or DTF placements. For all-over and sublimation products,
  check Printful's placement guidance for whether the print area includes
  bleed; Pressline passes the provider's numbers through unchanged.
- The DPI comes from Printful's catalog per placement: 150 for most garment
  placements, 300 for paper, phone cases and stickers, and DTF asks for 300.
  Use the Spec's value. Do not exceed it by upscaling; Printful's guidance is
  not to go above 300, and a file with more pixels than the Spec is rejected
  anyway.
- Stamp the DPI (`pHYs`, or JFIF density). Printful reads it back as the file's
  DPI in its own file library, and an export mode that drops it to 72 makes
  the file look wrong in every preview.

## Color

- **sRGB, 8 bits per channel**, declared. Printful's printing system is
  optimized for sRGB and converts to the printer's own CMYK itself; converting
  earlier only loses color information.
- **Never embed a non-sRGB profile.** Adobe RGB, ProPhoto and CMYK profiles are
  the documented cause of dark or shifted prints.
- **Expect DTG prints darker and less saturated** than a screen. Neon and
  very light pastels flatten. White is not printed on white garments: a white
  element on a white tee is a blank product, which Printful charges for.
- **Do no color management of your own** beyond producing sRGB. Pressline
  never alters pixels, and Printful does its own conversion.

## Transparency by technique

The alpha rule follows the technique, and the formats follow the alpha rule:

| Technique                                             | `alpha`     | `formats`   | What the pixels mean                                                                                                                     |
| ----------------------------------------------------- | ----------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `dtg` (direct to garment)                             | `allowed`   | PNG         | Transparent pixels print nothing and the garment shows through. Avoid semi-transparent edges; they print as speckle.                     |
| `dtfilm` (direct to film)                             | `allowed`   | PNG         | As DTG, but 300 dpi and hard edges: lines at least 1 pt, about 4 px. No soft shadows or gradients to transparent.                        |
| `embroidery`                                          | `allowed`   | PNG         | Transparent background required in practice. Printful redraws the design for stitching and asks the Operator to approve; keep it simple. |
| `uv`                                                  | `allowed`   | PNG         | Pixels at 0 % or 100 % transparency only; partial alpha prints as noise on phone cases.                                                  |
| Everything else: paper, sublimation, all-over cut-sew | `forbidden` | PNG or JPEG | The file must be opaque. Flatten onto the product color or white. Printful suggests no white or transparent elements on all-over prints. |

`required` exists in the protocol but Pressline's Printful derivation never
produces it: where transparency is allowed, a design may always choose a solid
background instead.

## What Pressline checks, and what it does not

Pressline rejects before any payment when:

| Check            | Rejection when                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| `spec_hash`      | The `specHash` you echo is not the one Pressline sent.                                 |
| `format`         | The declared `contentType` is not in `formats`, or the file's signature disagrees.     |
| `content_type`   | The served `Content-Type` differs from the declared one.                               |
| `content_length` | The served length differs from the `bytes` you declared.                               |
| `header`         | No readable PNG or JPEG header in the first 64 KiB, including a malformed chunk table. |
| `dimensions`     | Width or height differs from the Spec, or from the `width` and `height` you declared.  |
| `alpha`          | Alpha present on `forbidden`, absent on `required`, or unseen on either.               |

Pressline does **not** yet check bit depth, interlacing, the color space
chunks, the identity of an embedded profile, the `pHYs` stamp against
`spec.dpi`, or a JPEG's component count. Printful prints whatever it receives,
so a 16-bit, Adobe RGB or CMYK file passes today and comes back wrong from the
printer. Ship the file correct regardless. Tighter checks are tracked in
[issue #87](https://github.com/dworznik/pressline/issues/87).

## Limits Printful enforces itself

These are the only hard refusals Printful documents, and Pressline checks none
of them yet:

- **200 MB** maximum file size.
- **20 000 px** maximum on either side.
- **One dot in the filename.** A URL whose last path segment reads
  `name..png` fails Printful's upload. Content-addressed names like
  `<specHash>.png` are safe.
- **No stitch files** for embroidery (DST, PES, EXP). Send the image; Printful
  digitizes it.

## Checking your files

- `pressline printfile check <url> --offer <slug> --variant <key>` runs the same
  validator the bridge runs, against any URL, and prints the Spec, what it
  found in the file, and each problem. See the [CLI reference](/reference/cli/).
- The [conformance suite](/engine/conformance/) drives your Engine end to end
  and validates the file it produces exactly as production would.
- Diff your output against `@pressline/render`'s: same IHDR, same three
  ancillary chunks, `IDAT` near the top. `pngcheck -v file.png` or
  `exiftool file.png` lists the chunk table.
