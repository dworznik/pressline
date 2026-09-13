# What one 64 KB header read can prove about a Printfile

Research for [#109](https://github.com/dworznik/pressline/issues/109), a sub-issue of the
Wayfinder map [#107](https://github.com/dworznik/pressline/issues/107). No decisions are
taken here; this is the factual groundwork a later ticket writes a reject / Deviation
table against.

**What Validation does today.** `packages/contract/src/validate.ts` issues one ranged GET
for `bytes=0-65535` (`HEADER_BYTES` = 64 KB), parses the prefix with `parseImageHeader`,
and for PNG walks the chunk table from offset 8 until it finds `tRNS`, `IDAT` or `IEND`.
For JPEG it walks marker segments until the first SOF. It never decodes pixels (ADR-0002).

**How to read.** Every property below answers two questions, and they are different
questions:

1. **Reachable** — does the byte that carries this property lie inside the first 64 KB?
2. **Absence distinguishable** — when we do not see the property, can we tell "the file
   does not have it" from "we did not read far enough to know"?

A property that is reachable and whose absence is distinguishable can become a rejection.
A property whose absence is indistinguishable from unseen cannot, because the same
observation would reject a conforming file and a file we simply failed to read.

**Confidence.** Every structural claim is cited to the format's own specification.
Rows marked **measured** are things observed on this machine (macOS 15, ImageMagick 7,
exiftool 13) on 2026-09-13 — true of those encoders that day, not promises.

---

## 1. The structural facts

### 1.1 PNG framing and the ordering rule

A PNG is an 8-byte signature followed by chunks of `length(4) + type(4) + data(length) +
CRC(4)`. The length field "shall not exceed 2^31-1 bytes", and each type byte is
restricted to `0x41`–`0x5A` and `0x61`–`0x7A`
([PNG 3rd Edition §5.3, Table 5.1](https://www.w3.org/TR/png-3/#5Chunk-layout)).
There is no sync marker and no alignment: chunk boundaries are **computed**, never
searched. Two consequences follow immediately, and both matter more than they look.

The decisive fact for us is the chunk ordering table
([§5.6, Table 53 "Chunk ordering rules"](https://www.w3.org/TR/png-3/#table53)). Every
chunk that carries color or physical-size information is **required** to precede the first
`IDAT`:

| Chunk  | Ordering constraint, verbatim             |
| ------ | ----------------------------------------- |
| `IHDR` | Shall be first                            |
| `cICP` | Before PLTE and IDAT                      |
| `iCCP` | Before PLTE and IDAT                      |
| `sRGB` | Before PLTE and IDAT                      |
| `gAMA` | Before PLTE and IDAT                      |
| `cHRM` | Before PLTE and IDAT                      |
| `sBIT` | Before PLTE and IDAT                      |
| `PLTE` | Before first IDAT                         |
| `tRNS` | After PLTE; before IDAT                   |
| `bKGD` | After PLTE; before IDAT                   |
| `pHYs` | Before IDAT                               |
| `eXIf` | Before IDAT                               |
| `IDAT` | Multiple IDAT chunks shall be consecutive |
| `IEND` | Shall be last                             |

Conformance is not advisory: "The sequence of chunks in the PNG datastream obeys the
ordering relationship specified in this International Standard"
([§15.1](https://www.w3.org/TR/png-3/#15FileConformance)).

**So: stopping the walk at the first `IDAT` is sound.** No spec-conforming file can hide
`sRGB`, `gAMA`, `iCCP`, `cHRM`, `cICP`, `sBIT`, `pHYs`, `PLTE` or `tRNS` behind it. The
only chunks whose ordering constraint is literally **"None"** — legal anywhere between
`IHDR` and `IEND` — are `tEXt`, `zTXt`, `iTXt` and `tIME`, none of which we read. (APNG's
`fcTL`/`fdAT` are required after `IDAT`; also not ours.)

Two caveats on `eXIf`. PNG 3 says "Before IDAT", but the registry document that originally
defined it,
[PNG Extensions 1.5.0 §3.7](https://ftp-osl.osuosl.org/pub/libpng/documents/pngext-1.5.0.html),
says it "may appear anywhere between the IHDR and IEND chunks except between IDAT chunks".
Files written against the extension spec may legitimately carry `eXIf` after `IDAT`. We do
not read `eXIf` today; if a DPI check ever wants it, this is the trap.

And the spec forbids inferring more than the table grants: "Decoders shall not assume more
about the positioning of any ancillary chunk than is specified by the chunk ordering rules"
([§14.3.2](https://www.w3.org/TR/png-3/#14Ordering-of-ancillary-chunks)). Ancillary chunks
need not appear in the table's own order — **measured**: ImageMagick emits `iCCP` then
`cHRM`, and `sRGB` then `gAMA` then `PLTE`.

### 1.2 JPEG framing and the ordering rule

Markers are `0xFF` + a code that is neither `0x00` nor `0xFF`, optionally preceded by any
number of `0xFF` fill bytes; segment markers carry a 2-byte big-endian length that
**includes itself** ([T.81 §B.1.1.2, §B.1.1.4](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)).
`SOI`, `EOI`, `RSTn` and `TEM` stand alone with no length. Maximum length value is 65535
(T.81 Table B.9), so **65533 payload bytes** — a single segment can never span more than
64 KB, but several can.

JPEG's ordering rule is much weaker than PNG's. T.81 §B.2.1 says a frame header "may be
preceded by one or more table-specification or miscellaneous marker segments", and — the
decisive sentence — "**Each scan header may be preceded by one or more table-specification
or miscellaneous marker segments**". §B.2.4 confirms those segments "may be present in any
order and with no limit on the number of segments", and Figure B.5 lists **application
data** (APPn) among them.

**So: stopping at the first SOF is _not_ sound in general.** A conforming encoder may write
`SOI … SOF0 … APP2 … SOS`. What rescues us is the layered specs, each of which pins its own
marker to the front:

| Marker             | Required position                                    | Source                                         |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------- |
| APP0 `JFIF`        | "shall immediately follow the SOI marker"            | T.871 §6.1, §6.3                               |
| APP0 `JFXX`        | must immediately follow the JFIF APP0                | T.871 §6.4                                     |
| APP1 `Exif`        | "shall be recorded immediately after the SOI marker" | Exif 2.32 §4.5.4, §4.7.2 A                     |
| APP2 `ICC_PROFILE` | **no placement requirement at all**                  | ICC.1:2010 Annex B.4 / Technote 10-21 — silent |
| APP14 `Adobe`      | **no placement requirement at all**                  | Adobe TN #5116 §18 — silent                    |

The two markers with no specified placement are exactly the two that carry color meaning.
By convention libjpeg writes both immediately after `SOI`/`APP0` (`jcmarker.c`,
`write_file_header`), and **measured**, ImageMagick does the same: APP14 at offset 2 or 20
in every CMYK JPEG built here. The defensible cutoff for any future color check is the
**first SOS**, not the first SOF — that is where T.81 stops allowing a miscellaneous
segment ahead of entropy-coded data, and it costs only the handful of DQT/DHT bytes in
between.

A JFIF file cannot also be a strictly conforming Exif file: both specs demand their segment
be immediately after `SOI`, and Exif never mentions JFIF or APP0 anywhere (verified by
exhaustive search of DC-008-2019 and DC-008-2024). Both layouts are legal per T.81.

---

## 2. PNG, property by property

### 2.1 IHDR: dimensions, bit depth, color type, interlace

IHDR is always the first chunk and its length is always 13
([§11.2.2](https://www.w3.org/TR/png-3/#11IHDR)), so the offsets are fixed. The spec never
prints them; they follow from the 8-byte signature plus chunk framing, and are confirmed
**measured** (the second chunk always starts at 33).

| Offset | Size | Field                | Legal values                                                                  |
| -----: | ---: | -------------------- | ----------------------------------------------------------------------------- |
|    0–7 |    8 | Signature            | `89 50 4E 47 0D 0A 1A 0A`                                                     |
|   8–11 |    4 | IHDR length          | always 13                                                                     |
|  12–15 |    4 | IHDR type            | `49 48 44 52`                                                                 |
|  16–19 |    4 | Width                | 1 … 2^31-1; "Zero is an invalid value"                                        |
|  20–23 |    4 | Height               | 1 … 2^31-1                                                                    |
| **24** |    1 | **Bit depth**        | 1, 2, 4, 8, 16 — "not all values are allowed for all color types"             |
| **25** |    1 | **Color type**       | 0, 2, 3, 4, 6 (1, 5, 7 do not exist)                                          |
| **26** |    1 | Compression method   | **0 only** — "All conforming PNG images shall be compressed with this scheme" |
| **27** |    1 | Filter method        | **0 only**                                                                    |
| **28** |    1 | **Interlace method** | **0 = none, 1 = Adam7** — no other value defined                              |
|  29–32 |    4 | CRC                  |                                                                               |
|     33 |    — | second chunk begins  |                                                                               |

Allowed depth-by-type combinations ([Table 11.1](https://www.w3.org/TR/png-3/#table111)):
grayscale (0) → 1, 2, 4, 8, 16; truecolor (2) → 8, 16; indexed (3) → 1, 2, 4, 8, and a
`PLTE` chunk shall appear; grayscale+alpha (4) → 8, 16; truecolor+alpha (6) → 8, 16.

§15.2.3 makes an unrecognized value in any of these five bytes a reportable error, and
§13.3 says a decoder "should treat an unexpected chunk length as an error" for
known-length chunks such as IHDR.

**Measured**, confirming offsets 24–28: a 16-bit RGB PNG reads `10 02 00 00 00`; an
interlaced palette PNG reads `01 03 00 00 01`.

| Property           | Reachable in 64 KB | Absence distinguishable |
| ------------------ | ------------------ | ----------------------- |
| Width, height      | Always (offset 16) | n/a — mandatory field   |
| Bit depth          | Always (offset 24) | n/a — mandatory field   |
| Color type         | Always (offset 25) | n/a — mandatory field   |
| Compression/filter | Always (26, 27)    | n/a — mandatory field   |
| **Interlace**      | **Always (28)**    | n/a — mandatory field   |

Everything the map wants to reject on in IHDR — 16-bit depth, interlacing — sits in the
first 29 bytes of the file and can never be unseen. These are the cheapest possible checks.

### 2.2 `tRNS` and alpha

Color types 4 and 6 carry an alpha channel in IHDR itself. Types 0, 2 and 3 can still carry
transparency via `tRNS`, which is required "After PLTE; before IDAT". So alpha is fully
determined by the pre-`IDAT` region — **provided the walk actually reaches `IDAT`**. See
§5, which is where this becomes a real defect.

### 2.3 `pHYs` and DPI

Nine bytes of data ([§11.3.5.3](https://www.w3.org/TR/png-3/#11pHYs)): pixels per unit X
(4), pixels per unit Y (4), unit specifier (1). Unit `0` = unknown, unit `1` = the metre.
No other values are defined.

The spec gives no DPI formula; it follows from the unit being the metre:
`dpi = ppu × 0.0254`. So 150 dpi → 5906, 300 dpi → 11811. Our own encoder
(`packages/render/src/png.ts`) writes `Math.round(dpi / 0.0254)` with unit 1, which agrees.

**With unit specifier 0 there is no DPI at all** — only the ratio ppuX:ppuY is meaningful
("the pHYs chunk defines pixel aspect ratio only; the actual size of the pixels remains
unspecified"). A `pHYs` with unit 0 must never be converted to DPI. And "If the pHYs chunk
is not present, pixels are assumed to be square, and the physical size of each pixel is
unspecified" — absence is meaningful, not an error.

`pHYs` is 21 bytes on the wire and required before `IDAT`. It falls outside a 64 KB prefix
only when something ahead of it is large — in practice only `iCCP` or `eXIf`.

### 2.4 `sRGB`, `gAMA`, `cICP` and precedence

`sRGB` is one byte of chunk data, the rendering intent (0 perceptual, 1 relative
colorimetric, 2 saturation, 3 absolute colorimetric) — 13 bytes on the wire
([§11.3.3.5](https://www.w3.org/TR/png-3/#11sRGB)). It carries no profile: "If the sRGB
chunk is present, the image samples conform to the sRGB color space". `gAMA` is four bytes,
gamma × 100000, so sRGB's companion value is 45455 — which is exactly what our encoder
writes.

Precedence is normative
([§4.2, Color Chunk Priority](https://www.w3.org/TR/png-3/#color-chunk-precendence)):
`cICP` = 1, `iCCP` = 2, `sRGB` = 3, `cHRM`+`gAMA` = 4, and "the chunk with the lowest
Priority number should take precedence and any higher-numbered chunk types should be
ignored". Each of these chunks carries the sentence "This chunk is ignored unless it is the
highest-precedence color chunk understood by the decoder."

**This is load-bearing for any color check.** A file carrying both `iCCP` and `sRGB` is
governed by the `iCCP`, not the `sRGB` — so "the file declares sRGB" cannot be answered by
finding an `sRGB` chunk alone. The spec recommends against writing both ("It is recommended
that the sRGB and iCCP chunks do not appear simultaneously"), but recommends, not requires.
`cICP`, if present and understood, outranks everything.

All four are ≤ 45 bytes on the wire and required before `IDAT`.

### 2.5 `iCCP`

Layout ([§11.3.3.3](https://www.w3.org/TR/png-3/#11iCCP)): profile name (1–79 bytes,
printable Latin-1 and spaces only, case-sensitive), null separator, compression method
(1 byte), compressed profile. Only method 0 is defined: a zlib datastream
([RFC 1950](https://www.rfc-editor.org/rfc/rfc1950)) wrapping deflate, complete within the
one chunk — §10.3: "such datastreams are not split across chunks; each such chunk contains
an independent zlib datastream". PNG additionally requires method code 8, a window of at
most 32768 bytes, and **no preset dictionary**; and permits a smaller window for payloads
of 16384 bytes or fewer.

The spec also constrains what the profile may be: "The color space of the ICC profile shall
be an RGB color space for color images (color types 2, 3, and 6), or a greyscale color
space for greyscale images (color types 0 and 4)." A CMYK profile in a color-type-2 PNG is
therefore already non-conforming — though nothing stops an Engine from writing one.
**Measured**: ImageMagick wrote exactly that, an `iCCP` with data color space `CMYK` in a
truecolor PNG.

**Size.** No `iCCP`-specific limit; only the universal 2^31-1 chunk-data cap. Real profiles
span four orders of magnitude:

| Profile                                                  |     Bytes | Deflated (level 9) |
| -------------------------------------------------------- | --------: | -----------------: |
| Display P3                                               |       536 |                348 |
| Adobe RGB (1998)                                         |       560 |                282 |
| sRGB IEC61966-2.1 (the classic v2)                       |     3 144 |              2 594 |
| sRGB2014.icc                                             |     3 024 |              2 553 |
| Apple Generic CMYK Profile                               |    55 280 |             36 673 |
| sRGB v4 ICC preference                                   |    60 960 |             59 588 |
| US Web Coated (SWOP) v2                                  |   557 168 |            383 374 |
| Coated GRACoL 2006                                       |   654 372 |            482 286 |
| Uncoated_Fogra47L_VIGC_300 (largest in the ICC registry) | 8 652 448 |                  — |

Sources: [ICC profile registry](https://registry.color.org/), Adobe's own ICC bundle,
macOS ColorSync profiles. The ICC format's own ceiling is the 4-byte size field, 2^32-1
(ICC.1:2022 §7.2.2); the spec states no practical maximum.

**The shape of the risk.** The overwhelmingly common case is tiny: a corpus scan of 27 891
PNGs found 5 417 `iCCP` chunks with a **median chunk length of 2 617 bytes** and a maximum
of 20 095, every one starting within the first 14 797 bytes. A 64 KB window covered the
entire pre-`IDAT` region of every file in that corpus. But that is a heuristic about what
encoders do, not a bound. A print-oriented Engine embedding a real CMYK output profile
(550–650 KB, ~400–480 KB deflated) pushes `IDAT` — and every chunk after the `iCCP` —
far past 64 KB. **Measured**: embedding the 55 KB Apple CMYK profile produced a PNG whose
`IDAT` header sits at byte **81 488**, outside the window.

### 2.6 PNG summary

| Property                       | Where                             | 64 KB reaches it                                   | Absence vs unseen                          |
| ------------------------------ | --------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| Width, height                  | bytes 16–23                       | Always                                             | n/a, mandatory                             |
| Bit depth                      | byte 24                           | Always                                             | n/a, mandatory                             |
| Color type                     | byte 25                           | Always                                             | n/a, mandatory                             |
| Interlace                      | byte 28                           | Always                                             | n/a, mandatory                             |
| `tRNS` / alpha                 | before `IDAT`                     | Only if the walk reaches `IDAT`                    | **Distinguishable only if `IDAT` is seen** |
| `pHYs` / DPI                   | before `IDAT`                     | Usually; not behind a large `iCCP`                 | **Distinguishable only if `IDAT` is seen** |
| `sRGB`, `gAMA`, `cHRM`, `cICP` | before `PLTE` and `IDAT`          | Usually; not behind a large `iCCP`                 | **Distinguishable only if `IDAT` is seen** |
| `iCCP` **presence + size**     | before `PLTE` and `IDAT`          | Header reachable unless a bigger chunk precedes it | Yes, if `IDAT` is seen                     |
| `iCCP` **profile color space** | offset 16 of the inflated profile | Compressed bytes yes; value needs an inflate       | See §4                                     |

---

## 3. JPEG, property by property

### 3.1 SOF: dimensions, precision, channel count

Layout from the `0xFF` ([T.81 §B.2.2, Figure B.3, Table B.2](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)):

| Offset | Field                             |
| -----: | --------------------------------- |
|  +0,+1 | `FF` + SOF code                   |
|     +2 | `Lf` length, = 8 + 3 × `Nf`       |
|     +4 | `P` sample precision              |
|     +5 | `Y` number of lines (height)      |
|     +7 | `X` samples per line (width)      |
|     +9 | `Nf` number of components         |
| +10+3i | `Ci` component identifier         |
| +11+3i | `Hi`/`Vi` sampling factors        |
| +12+3i | `Tqi` quantization table selector |

SOF codes are `0xC0`–`0xCF` **except** `0xC4` (DHT), `0xC8` (JPG) and `0xCC` (DAC) — which
is exactly what `parseImageHeader` already tests. `P` is 8 for baseline; 8 or 12 for
extended sequential and progressive; 2–16 for lossless. `Nf` is 1–255 except in progressive
mode, where it is 1–4.

**Channel count is `Nf`, and only `Nf`** — cross-checkable as `(Lf - 8) / 3`. **SOF carries
no color space.** T.81 defines `Ci` as nothing more than "a unique label", and says so
outright in §1 and §4.1: color space designation is "application-dependent" and "outside
the scope of this Specification". So `Nf = 4` means four channels, not "CMYK".

Component-ID conventions are split between one normative source and one reference
implementation:

- **Normative**: T.871 §10.1 constrains a JFIF file to `Nf` = 1 or 3 with `C1`=1 (Y),
  `C2`=2 (Cb), `C3`=3 (Cr).
- **Reference implementation only** (libjpeg `jdapimin.c`): IDs `'R','G','B'`
  (`52 47 42`) mean RGB; `'C','M','Y','K'` (`43 4D 59 4B`) mean CMYK. These appear in no
  published standard. libjpeg checks component IDs **before** APP0/APP14.

**The `Y = 0` trap.** T.81 §B.2.2: "Value 0 indicates that the number of lines shall be
defined by the DNL marker and parameters at the end of the first scan." A conforming JPEG
may declare height 0 in SOF and carry the real height in a `DNL` segment after the first
scan — unreachable by any header-only read. `parseImageHeader` would return `height: 0` and
Validation would report a dimension mismatch. Rare, but it is a header that is _legal_ and
_unreadable_, and the error message would be misleading.

### 3.2 APP0 JFIF density

Layout ([T.871 §10.1](https://www.itu.int/rec/T-REC-T.871)): `FF E0`, length,
`"JFIF\0"` (5 bytes at +4), version (2 at +9), **units (1 byte at +11)**, Hdensity (2 at
+12), Vdensity (2 at +14), thumbnail dims (1+1 at +16, +17), then 3 bytes per thumbnail
pixel.

Units: `0` = unspecified, densities give pixel aspect ratio only; `1` = **dots per inch**;
`2` = dots per cm. Hdensity and Vdensity "must be non-zero". The segment "shall immediately
follow the SOI marker", so when present it is at file offset 2.

### 3.3 APP1 Exif resolution, and the disagreement

Layout (Exif 2.32 §4.7.2 B): `FF E1`, length, `"Exif"` + `00 00` (6 bytes at +4), then a
TIFF header at +10 — byte order `II` or `MM`, the constant 42, and the offset to IFD0,
**all offsets relative to the first byte of the byte-order field**.

Tags: `XResolution` 0x011A (RATIONAL, default 72), `YResolution` 0x011B (RATIONAL, default
72), `ResolutionUnit` 0x0128 (SHORT, default 2). Exif's unit codes are **2 = inches,
3 = centimeters** — note that the value 2 means _inches_ in Exif and _dots per cm_ in JFIF,
and Exif has no equivalent of JFIF's "unspecified".

APP1 is capped at 64 KB ("The APP1 segment cannot record more than 64 KBytes"), and Exif
has no cross-segment offset mechanism, so IFD0, the Exif IFD, the GPS IFD and the entire
embedded thumbnail all live inside that one segment. This is a real budget consumer: an
APP1 with a thumbnail can be 64 KB on its own, which alone pushes SOF past our window.

**Which wins when they disagree? No primary specification says.** T.81 declares APPn
interpretation "left to the application". T.871 says nothing about any other segment's
metadata. Exif never mentions JFIF or APP0 at all — verified by exhaustive search of both
DC-008-2019 (Exif 2.32) and DC-008-2024 (Exif 3.1): zero occurrences of "JFIF" or "APP0" in
either. This is **genuinely unspecified**, and any policy we adopt is ours, not the
standard's.

Two facts that constrain a sensible policy rather than decide it. libjpeg parses JFIF APP0
for density and **does not parse Exif at all** — APP1 is not in its
`get_interesting_appn` switch — so for the most widely deployed decoder, JFIF wins by
default. And Exif explicitly defines 72/unit-2 as the _unknown_ value ("When the image
resolution is unknown, 72 [dpi] shall be designated", "If the image resolution in unknown,
2 (inches) shall be designated"), so an Exif resolution of exactly 72 dpi carries no
information and should never override an explicit JFIF density.

**Measured**: a JPEG can carry both and they can disagree. ImageMagick wrote APP0 with
units 1 / 300×300 alongside an Exif APP1 — and, separately, **dropped the JFIF density to
units 0 when asked to embed an ICC profile**, so the presence of APP2 can silently destroy
the DPI stamp our `print/files.md` promises.

### 3.4 APP2 `ICC_PROFILE`

The text lives in ICC.1:2010 Annex B.4, reproduced verbatim in
[ICC Technote 10-21](https://www.color.org/technotes/ICC-Technote-ProfileEmbedding.pdf).
ICC.1:2022 deleted the annex and points at the technote. Both are labeled
**(informative)** — there is no _normative_ ICC text for JPEG embedding.

Layout: `FF E2`, length, `"ICC_PROFILE\0"` (**12 bytes** at +4), **chunk sequence number
(1 byte at +16, counting starts at 1)**, **total chunk count (1 byte at +17)**, then
profile data. Per chunk: 65533 − 12 − 2 = **65519 bytes**. With a 1-byte count, at most 255
chunks, so the maximum embeddable profile is **255 × 65519 = 16 707 345 bytes** — the exact
figure the ICC states, which confirms the field sizes.

Placement and contiguity are **not** specified. The only stated rule is that all chunks
"should" agree on the total count. A reader must collect every APP2 whose data begins with
the identifier, sort by sequence number, and concatenate.

**The budget consequence is the important one.** A profile of 65519 bytes or less occupies
one APP2 and leaves SOF inside our window; anything larger needs two or more and pushes SOF
past 64 KB. **Measured**: embedding the 55 280-byte Apple CMYK profile produced one APP2
and put SOF at byte **55 456** — inside the window, but with under 10 KB to spare.

### 3.5 APP14 `Adobe`

Layout ([Adobe TN #5116 §18](https://pdfa.org/norm-refs/5116.DCT_Filter.pdf)): `FF EE`,
length (**always 14**), `"Adobe"` as a five-character ASCII string at +4 with **no trailing
null**, version (2 bytes at +9), flags0 (2 at +11), flags1 (2 at +13), and the
**transform byte at +15** — i.e. index 11 of the application data, which is exactly where
libjpeg reads it (`APP14_DATA_LEN 12`, `data[11]`). **Measured**: confirmed at file offset
17 and 35 in two ImageMagick CMYK JPEGs.

Version: TN 5116 says 101; libjpeg writes 100 and explains why — "all the Adobe files now
in circulation seem to use Version = 100". Accept both.

**The transform values are not in any published Adobe standard.** TN 5116 §18 says only
"One-byte color transform code" and does not enumerate it. Adobe's published enumeration is
in PLRM 3rd ed. and ISO 32000-1 Table 13, and has only two values: 0 = no transformation,
1 = RGB→YUV if 3 components / CMYK→YUVK if 4. The familiar three-way reading comes from
libjpeg (`jcmarker.c`, `jdapimin.c`), whose own comment concedes it is a reinterpretation
("Adobe's definition has to do with whether the encoder performed a transformation, which
is pretty useless"):

| `Nf` | transform 0 | transform 1 | transform 2 | other       |
| ---- | ----------- | ----------- | ----------- | ----------- |
| 3    | **RGB**     | **YCbCr**   | —           | warn, YCbCr |
| 4    | **CMYK**    | —           | **YCCK**    | warn, YCCK  |

With no APP14 and unrecognized component IDs, libjpeg assumes straight CMYK for `Nf` = 4.

**So for a CMYK-detection check: `Nf = 4` is the signal, and APP14 only tells you which
4-channel encoding it is.** Both `transform = 0` (CMYK) and `transform = 2` (YCCK) are CMYK
data. A 4-component JPEG with no APP14 at all is still CMYK. **Measured**: ImageMagick's
CMYK JPEG carried APP14 transform 2, `Nf` = 4, and **no JFIF APP0 at all**.

One more thing not to build a rule on: Photoshop writes CMYK JPEG sample values inverted.
This is documented only by libjpeg (`libjpeg.txt`, "Special color spaces"), is a
_writer_ behavior rather than an APP14 semantic, and libjpeg explicitly refuses to
normalize it because Ghostscript's CMYK JPEGs also carry an Adobe APP14 and are **not**
inverted. Since we never decode pixels, this is not ours to solve — but it is a reason not
to read polarity into the presence of APP14.

### 3.6 JPEG summary

| Property                | Where                           | 64 KB reaches it                             | Absence vs unseen                            |
| ----------------------- | ------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Width, height           | SOF +5, +7                      | Unless APPn segments exceed ~64 KB           | `Y`=0 means "see DNL" — **unknowable**       |
| Precision               | SOF +4                          | With SOF                                     | n/a, mandatory                               |
| Channel count (`Nf`)    | SOF +9                          | With SOF                                     | n/a, mandatory                               |
| Color space             | **nowhere in SOF**              | —                                            | Must be inferred from APP14 + `Nf` + IDs     |
| JFIF units/density      | APP0 +11, +12, +14              | Always (offset 2 by spec)                    | Yes — APP0 is either there or not            |
| Exif resolution         | APP1, inside a TIFF IFD         | Yes, but APP1 alone can be 64 KB             | Yes if we reach SOS; defaults mean "unknown" |
| ICC profile color space | APP2 chunk 1, profile offset 16 | Yes if the profile ≤ 65519 bytes             | **Only if we reach SOS**                     |
| Adobe transform         | APP14 +15                       | By convention yes; **no required placement** | **Only if we reach SOS**                     |

---

## 4. Identifying sRGB from an `iCCP` chunk

This is the question the map's "non-sRGB `iCCP` is a reject" line depends on.

### 4.1 What the profile name tells you: nothing

The PNG spec is explicit that the name is free text — "may be any convenient name for
referring to the profile", case-sensitive, 1–79 printable Latin-1 bytes. No conventional
name is prescribed. A corpus scan of 5 417 real `iCCP` chunks found four common spellings:
`Photoshop ICC profile` (~2 600), `ICC Profile` (~1 150), `sRGB IEC61966-2.1` (~350),
`kCGColorSpaceGenericRGB` (183), `kCGColorSpaceDisplayP3` (95). **Measured**: ImageMagick
names every profile it embeds `icc`, whether the profile is sRGB, grayscale or CMYK — the
human-readable "Generic CMYK Profile" lives in the `desc` tag _inside_ the compressed
profile, not in the chunk's name field.

So: the name is a logging aid and nothing more. A check must never key off it.

### 4.2 Where the color space lives, and whether the header is enough

The ICC header is 128 bytes, 18 fields (ICC.1:2022 §7.2.1, Table 17). The relevant offsets:

| Offset | Size | Field                                                                         |
| -----: | ---: | ----------------------------------------------------------------------------- |
|      0 |    4 | Profile size (uInt32, big-endian)                                             |
|     12 |    4 | Profile/device class — `mntr`, `prtr`, `scnr`, `link`, `spac`, `abst`, `nmcl` |
| **16** |    4 | **Data color space signature** — `RGB `, `CMYK`, `GRAY`, `Lab `, `XYZ `, …    |
|     20 |    4 | PCS                                                                           |
|     36 |    4 | Profile file signature, always `acsp` (`61637370`)                            |
|     64 |    4 | Rendering intent                                                              |
|     84 |   16 | Profile ID (MD5), **often all zeros**                                         |

Two spec errata worth knowing: the _heading_ of ICC.1:2022 §7.2.6 reads "bytes 16 to 20",
which contradicts its own Table 17 (16 to 19) and §7.2.7 (PCS at 20 to 23) — the field is
4 bytes at offset 16. And ICC.1:2010 §7.2.9's prose gives `acsp` as `61637379h`, which is
wrong; Table 17 and ICC.1:2022 both say `61637370h`.

**Nothing in the 128-byte header identifies sRGB.** Table 19 has one `RGB ` signature
covering every RGB space; there is no sRGB color-space signature, no sRGB class, no sRGB
flag. Searching the whole of ICC.1:2022 for "sRGB" returns four hits, none of them a header
field. The near-miss is the device-model field at offset 52, which _can_ carry `sRGB`
(registered at registry.color.org under manufacturer `IEC `) — but `sRGB2014.icc` leaves it
zero and the v4 preference profile writes `none`, so it is a positive hint at best, never a
negative.

**And there is no canonical "this is sRGB" in ICC at all.** The ICC expresses its position
only by publishing reference profiles, and there are at least five legitimate ones:
the 3144-byte IEC61966-2.1, the 3024-byte `sRGB2014.icc`, the 60 960-byte
`sRGB_v4_ICC_preference.icc`, its 60 988-byte display-class twin, and the 63 868-byte
`sRGB_ICC_v4_Appearance.icc`. Any allowlist has to hold all of them plus vendor variants.

The only exact identification the spec supports is the Profile ID (§7.2.18): MD5 over the
whole profile with bytes 44–47, 64–67 and 84–99 zeroed. That is well-defined and
verifiable — but it needs the **entire** profile, not the header, and the field is
advisory ("should compute and record"), so it is frequently zero, including in the single
most-embedded sRGB profile in the world.

### 4.3 Can the color space be read without inflating? Effectively no

The compressed bytes cannot be searched. Deflate is bit-oriented with two different bit
orders (RFC 1951 §3.1.1), block headers need not start on a byte boundary (§3.2.3), and in
a Huffman-coded block every literal is a variable-length code while most content is
LZ77 back-references that never appear as literals at all. The byte sequence `52 47 42 20`
(`RGB `) is simply not present to find.

The one exception is a **stored block** (BTYPE=00, RFC 1951 §3.2.4), where raw bytes appear
literally after a `LEN`/`NLEN` pair — the profile's first 128 bytes would sit at compressed
offset 7. Detection is cheap and unambiguous (byte 2's low 3 bits are `000` or `001`, and
`NLEN == LEN ^ 0xFFFF`). But a stored block _inflates_ the data, so it appears only at
compression level 0; every mainstream PNG encoder writes `iCCP` at a normal level. It is
correct but will essentially never be the path taken.

The two-byte zlib header (RFC 1950 §2.2) is readable and tells you the compression method
(CM=8), the window size (CINFO), header validity (`(CMF*256+FLG) mod 31 == 0`), whether a
preset dictionary follows (FDICT), and the encoder's effort level (FLEVEL). It tells you
**nothing about the content**. And there is no stable prefix to match against: **measured**,
the same sRGB profile deflates to `78019d96…`, `789c9d96…` and `78da9d96…` at levels 1, 6
and 9, and ImageMagick's small-window grayscale profile began `388d…`. Everything past byte
2 is the dynamic-Huffman code table, which varies with level, strategy, memLevel, encoder
and encoder version. Byte-comparing compressed bytes is not viable.

### 4.4 What a bounded inflate would cost — and the ADR-0002 question

**Technically, reading the ICC color space is cheap and bounded.** A streaming inflate
produces output incrementally, and a truncated input yields a valid truncated _prefix_ of
the output. **Measured**: feeding the first **256 compressed bytes** of the sRGB profile to
an incremental inflater with a 128-byte output budget returned exactly 128 bytes, with
`RGB ` at offset 16. Across 27 runs (three profiles × five level/strategy combinations),
between **68 and 162 compressed bytes** sufficed to emit the first 128 output bytes. Feeding
the first 512 compressed bytes is comfortably enough in every case measured.

An inflate bounded by an **output-byte budget** is O(128) work and immune to compression
ratio, so a malicious `iCCP` claiming a huge profile cannot turn it into a zip bomb.

**This is a judgment call for the humans, not for this document.** ADR-0002's operative
sentence is that Pressline "validates it by inspecting headers only (format, dimensions,
color type, size)" and that "Core has no image-decoding dependency beyond header parsing".
Inflating 128 bytes of an ICC header decodes **no pixels** and stores **no image bytes** —
the ADR's stated motivations (Worker CPU/memory limits, ~100 MB of raw RGBA, ownership of
color-management quality) are untouched by it. But it does add a decompression step to the
request path and does read data that is, strictly, inside a compressed chunk rather than in
the header. Whether that stays inside ADR-0002's sentence, needs an ADR amendment, or
should simply not be done is the decision [#107](https://github.com/dworznik/pressline/issues/107)
owns.

The alternatives if the answer is "no inflate": treat any `iCCP` as non-sRGB regardless of
content (precautionary, and the map's reject line already leans this way — but it would
reject a file carrying a genuine sRGB profile), or record its presence as a Deviation and
say nothing about its content.

---

## 5. Absent versus unseen — the decisive section

### 5.1 The good news: a straddling chunk is detectable

Because PNG chunk headers are 8 bytes and the length field says exactly where the chunk
ends, a walker that has the 8 header bytes inside the window knows **the chunk's type and
its full extent** without reading a byte of its data. So "an `iCCP` of 400 KB is present at
offset 33 and we did not read it" is a statement we can make precisely.

**Measured**, on the 84 636-byte test PNG truncated to 65 536 bytes: `IHDR`, `iCCP`, `cHRM`,
`PLTE`, `bKGD` and `tIME` were fully readable; `zTXt`'s header was readable and its data was
not (it needs byte 81 488). The walker knows the exact chunk at which it went blind.

Three things it cannot do. It cannot verify the CRC, so the type and length it read are
unauthenticated — and the spec warns that "an erroneous chunk length can cause the decoder
to get out of step and misinterpret subsequent data as a chunk header" (§13.3). It cannot
resynchronize by scanning, because chunk-type bytes occur freely inside compressed `IDAT`
payloads. And the 8-byte header can itself straddle the boundary, which must be treated as
"unknown from here", distinct from "no more chunks".

### 5.2 The bad news: our walk does not make the distinction

`parseImageHeader`'s PNG loop has two exits that produce the same result:

```ts
while (!hasAlpha && offset + 8 <= bytes.length) {
  const length = view.getUint32(offset)
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
  if (type === 'tRNS') hasAlpha = true
  if (type === 'IDAT' || type === 'IEND') break
  offset += 12 + length
}
```

Exiting via `break` on `IDAT` is **conclusive**: the spec guarantees every chunk we care
about is behind us. Exiting via the loop condition means we ran out of window and is
**inconclusive**. Both produce `hasAlpha: false`, and the caller cannot tell them apart.

**Measured**, on the 84 636-byte PNG whose `IDAT` header sits at byte 81 488:

| Input                  | Result            | How the loop ended                  |
| ---------------------- | ----------------- | ----------------------------------- |
| 64 KB prefix           | `hasAlpha: false` | ran out of bytes — **inconclusive** |
| whole file             | `hasAlpha: false` | reached `IDAT` — conclusive         |
| 64 KB of an alpha file | `hasAlpha: true`  | found `tRNS` — conclusive           |

The consequence is live: with `spec.alpha === 'required'`, `validatePrintfile` rejects that
file for having "no alpha channel" when the truthful statement is that we never looked. The
Printful-derived Catalog produces only `allowed` and `forbidden` today, so `required` is not
currently reachable in production — but the same conflation will mislead every check the
map wants to add, because `pHYs`, `sRGB` and `iCCP` all live in the same region and all
become invisible behind a large `iCCP`.

### 5.3 Two smaller conformance gaps in the same function

**PNG: no plausibility check on length or type.** The spec endorses both
([§13.3](https://www.w3.org/TR/png-3/#13Error-checking)): a length whose high bit is set
exceeds 2^31-1 and is by itself proof of a non-conforming stream, and "The chunk type can be
checked for plausibility by seeing whether all four bytes are in the range codes 41-5A and
61-7A". Today a corrupt length silently desynchronizes the walk and the result is
indistinguishable from a clean one.

**JPEG: fill bytes break the parser.** T.81 §B.1.1.2 permits "any number of fill bytes",
each `0xFF`, before any marker. The current loop skips `SOI`, `RSTn` and `TEM` but not a
`0xFF` in the marker-code position, so `FF FF C0 …` is misread as a segment with a bogus
length. Adobe TN #5116 §4 notes replicated fill markers are legal. Rare in practice, but it
is a spec-legal file we would fail to parse.

### 5.4 The answer, per property

| Property                                           | Can "absent" be told from "unseen"?                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG bit depth, color type, interlace, dimensions   | **Yes, always.** Fixed offsets in the first 29 bytes. Cannot be unseen.                                                                                                 |
| PNG `tRNS`, `pHYs`, `sRGB`, `gAMA`, `cICP`, `iCCP` | **Yes, but only by recording how the walk ended.** Reaching `IDAT` proves absence; running out of window proves nothing. The information exists — we simply discard it. |
| PNG `iCCP` **content**                             | **No, not without inflating.** Presence and size: yes. Color space: needs ~512 compressed bytes through an inflater.                                                    |
| JPEG `Nf` / channel count                          | **Yes**, if SOF is reached.                                                                                                                                             |
| JPEG height when `Y = 0`                           | **No.** Defined by `DNL` after the first scan; unreachable by any header read.                                                                                          |
| JPEG APP0 JFIF density                             | **Yes.** Spec-pinned to offset 2; if it is not there, it is not in the file.                                                                                            |
| JPEG APP1 Exif resolution                          | **Yes** if the scan reaches SOS; note 72 dpi / unit 2 is Exif's documented "unknown".                                                                                   |
| JPEG APP2 ICC, APP14 Adobe                         | **Only by scanning to the first SOS**, and only if total APPn bytes fit the window. Neither has a required placement.                                                   |

The shape of a truthful answer is therefore three-valued, not two: **present**, **provably
absent**, **not seen**. The third state is exactly what a Deviation is for, and it is
information the current code computes and throws away.

---

## 6. Budgets, in one table

| Quantity                                 | Value                                   |
| ---------------------------------------- | --------------------------------------- |
| Our read window (`HEADER_BYTES`)         | 65 536                                  |
| PNG max chunk data length                | 2 147 483 647 (2^31-1)                  |
| PNG bytes needed for IHDR alone          | 33                                      |
| PNG `sRGB` + `gAMA` + `pHYs` on the wire | 13 + 16 + 21 = 50                       |
| Our own encoder's full pre-`IDAT` region | 91 bytes (`packages/render/src/png.ts`) |
| JPEG max segment length field            | 65 535 (payload 65 533)                 |
| APP2 ICC bytes per chunk                 | 65 519                                  |
| APP2 max embeddable profile (255 chunks) | 16 707 345                              |
| Exif APP1 hard cap                       | 65 533 (minus the 6-byte identifier)    |
| Largest profile in the ICC registry      | 8 652 448                               |
| ICC format ceiling (4-byte size field)   | 4 294 967 295                           |

**When 64 KB is not enough.** For PNG, only when a chunk before `IDAT` is large — in
practice `iCCP` (a real CMYK output profile is 550–650 KB, ~400–480 KB deflated) or a big
`eXIf`. For JPEG, when the APPn segments before SOF sum past ~64 KB — an ICC profile over
65 519 bytes (two or more APP2 chunks), or an Exif APP1 carrying a thumbnail, which can be
64 KB by itself.

**A file our own Engine produces is never at risk**: `packages/render/src/png.ts` writes
signature, `IHDR`, `sRGB`, `gAMA`, `pHYs`, `IDAT`, `IEND`, so `IDAT` starts at byte 91 and
every observable property is in the first 100 bytes. The risk is entirely about
third-party Engines, which is precisely the population Validation exists to police.

---

## 7. Sources

All primary. Fetched or measured 2026-09-13.

- **PNG** — [W3C PNG Specification (Third Edition)](https://www.w3.org/TR/png-3/), W3C
  Recommendation 24 June 2025. (w3.org returns 403 to automated fetches; the byte-identical
  ReSpec source is the `Third-Edition` tag of the [w3c/png](https://github.com/w3c/png)
  repo. All `#anchor` links above resolve on the published Recommendation.) Historical
  cross-checks: [RFC 2083](https://www.rfc-editor.org/rfc/rfc2083.txt) §4.3,
  [PNG 1.2](http://www.libpng.org/pub/png/spec/1.2/PNG-Chunks.html) §4.3, and
  [PNG Extensions 1.5.0](https://ftp-osl.osuosl.org/pub/libpng/documents/pngext-1.5.0.html)
  for `eXIf`.
- **JPEG** — [CCITT Rec. T.81 | ISO/IEC 10918-1:1993](https://www.w3.org/Graphics/JPEG/itu-t81.pdf),
  Annex B.
- **JFIF** — [Rec. ITU-T T.871 (05/2011) | ISO/IEC 10918-5:2012](https://www.itu.int/rec/T-REC-T.871),
  corroborated by
  [Ecma TR/98](https://www.ecma-international.org/wp-content/uploads/ECMA_TR-98_1st_edition_june_2009.pdf).
- **Exif** — CIPA DC-008-Translation-2019-E | JEITA CP-3451E (Exif 2.32) and CIPA
  DC-008-2024-E (Exif 3.1), from [cipa.jp](https://www.cipa.jp/std/documents/download_e.html?DC-008-Translation-2019-E).
- **ICC** — [ICC.1:2022-05](https://www.color.org/specification/ICC.1-2022-05.pdf),
  [ICC.1:2010-12 (v4.3)](https://www.color.org/specification/ICC1v43_2010-12.pdf) Annex B.4,
  [ICC Technote 10-21 "Embedding profiles"](https://www.color.org/technotes/ICC-Technote-ProfileEmbedding.pdf),
  and the [ICC profile registry](https://registry.color.org/) for measured profile sizes.
- **Adobe APP14** — [Technical Note #5116, "Supporting the DCT Filters in PostScript Level 2"](https://pdfa.org/norm-refs/5116.DCT_Filter.pdf)
  §13.1, §18; PostScript Language Reference Manual 3rd ed. (`DCTEncode`/`DCTDecode`,
  `ColorTransform`); [ISO 32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
  Table 13.
- **Compression** — [RFC 1950](https://www.rfc-editor.org/rfc/rfc1950) (zlib),
  [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) (deflate).
- **Reference implementation, flagged as such wherever cited** — IJG libjpeg 9f
  (`jdmarker.c`, `jdapimin.c`, `jcmarker.c`, `libjpeg.txt`), [ijg.org](https://www.ijg.org/).
  libjpeg is not a standard; every claim sourced only from it is marked above.

**What is deliberately not here.** Whether any of this becomes a rejection, a Deviation or
silence; whether the window should grow, a second ranged read should be added, or the
three-valued result should simply be recorded; and whether a bounded inflate of an ICC
header is compatible with ADR-0002. Those are decisions for
[#107](https://github.com/dworznik/pressline/issues/107) and its remaining tickets.
