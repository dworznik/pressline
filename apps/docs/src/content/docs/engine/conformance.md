---
title: Checking your Engine
description: "The Engine developer's commands: the conformance suite, Preflight for local Printfiles, and the instance's Offers."
---

All three commands live in the `pressline` CLI and need no operator token.

## Conformance

Run the suite against your Engine before wiring it to an instance:

```sh
npx @pressline/cli engine conformance https://engine.example --secret $ENGINE_SECRET --design <a design id>
```

```
✓ health      protocol version 1
✓ design      "Blue heron" sellable, aspect 3:4
✓ preview     https://engine.example/p/heron.png answers 206
✓ render      answered 202 (retry after 500 ms), then 200 ready
✓ idempotent  a repeat request returns the same URL and Spec Hash
✓ printfile   https://engine.example/files/…: 1200×1600 image/png, 812345 bytes
✓ rejects     422 aspect_mismatch: this design is 3:4
Conformant.
```

The `printfile` check is Pressline's own validator from `@pressline/contract`, so what passes here passes in production. `--dpi` sets the Spec's DPI (default 150); `--timeout` raises the wait for slow renderers; `--any-shape` skips the 422 check for Engines that pad any Spec. Exit code 1 when the Engine is not conformant.

As a test helper, `conformance({ baseUrl, secret, designId, fetch })` from `@pressline/conformance` returns the same report for an in-process handler; the sample Engine's test suite is exactly that. The package's own binary, `npx @pressline/conformance …`, remains as an alias.

## Preflight

**Preflight** is the check you run on a file you have just written, before you
host it. It reads the whole file, compares it with a [Printfile
Spec](/engine/protocol/) and the [format's
requirements](/print/printfile/), and reports two tiers: what Validation would
refuse, and every **Deviation** — legal, sellable, but not what the protocol
documents. It guarantees nothing to anyone but you; the bridge decides for
itself when it fetches the file.

```sh
npx @pressline/cli engine preflight ./out --url https://shop.example --offer tee-black-front --variant black-m
```

```
Spec tee-black-front/black-m: 1800×2400px @ 150 dpi, png, alpha allowed (hash 3f9c1a2b7e01…)
File out/front.png: png 1800×2400, 8-bit color type 6, alpha present, 150×150 dpi, 812345 bytes
  ✓ nothing Validation would refuse
File out/back.png: png 1800×2400, 8-bit color type 2, alpha absent, no DPI stamped, 690112 bytes
  ✓ nothing Validation would refuse
  ⚠ dpi_missing: the file carries no pHYs chunk, so it states no print resolution; stamp 150 dpi into it
2 files against 1 Spec: 0 refused, 1 with Deviations, 1 clean.
```

**The Spec comes from the instance or from a file, never from your memory.**
`--offer` with `--variant` takes one variant's Spec from the public offers
endpoint at `--url`; `--offer` on its own checks against every distinct Spec
that Offer asks for, which is how you find out that the large size prints
bigger. `--spec` reads a Spec from a file or from `-`, either bare or as a group
straight out of `pressline offers --json`:

```sh
npx @pressline/cli offers --url https://shop.example --json | jq '.offers[0].specs[0]' \
  | npx @pressline/cli engine preflight ./out/front.png --spec -
```

A bare Spec's Spec Hash is recomputed and printed, so a hand-edited file cannot
quietly claim to be something else. With no Spec at all the report says
`no Spec: dimensions, alpha and DPI not checked` and checks only what the file
says about itself.

**Paths**: files, or directories. A directory contributes the `.png`, `.jpg` and
`.jpeg` files directly inside it — not recursed, no hidden files — while a path
you name is always checked, whatever it is called.

**Exit code**: 1 when any file has something Validation would refuse, 0 when the
only findings are Deviations. `--strict` fails on Deviations too, which is what
you want in CI. `--json` prints, per file, the Spec Hash checked against, the
header that was read, and separate `invalid` and `deviations` lists.

Preflight reads the whole file, where the bridge reads only the first 64 KiB.
When those two views disagree the report says so, because the bridge's is the
one that decides: _"Pressline reads only the first 65536 bytes, which stop
before the pixel data: its read sees alpha as unseen where the whole file says
absent."_ An embedded ICC profile is reported by name and size and left at that;
which profile it is is not checked yet.

The same check runs as a function for an Engine's own test suite, over bytes it
has just rendered and never writes to disk:

```ts
import { preflight } from '@pressline/cli/preflight'

const report = preflight({ path: 'front.png', bytes }, { spec })
expect(report.invalid).toEqual([])
```

`@pressline/render`'s own tests do exactly this, so a Deviation the helper
starts writing fails our suite rather than yours.

## Offers

What the instance asks you to render, straight from its public offers endpoint:

```sh
npx @pressline/cli offers --url https://shop.example
```

```
tee-black-front  Black tee, front print — front / dtg, €25.00
  1800×2400px @ 150 dpi, png, alpha allowed (hash 3f9c1a2b7e01…)  black-s, black-m, black-l
poster-18x24  Matte poster 18×24 — default / digital, aspect 0.7–0.8, €19.00
  2700×3600px @ 150 dpi, png/jpeg, alpha forbidden (hash 8ab04c2d91f7…)  18x24
```

Every size of a tee has the same Placement and therefore one Printfile Spec, so variants are grouped by Spec Hash: one line per distinct Spec, then the variant keys that share it. `--json` prints the same grouping as data, each group carrying its `spec` and `specHash`, so a group can be handed to a renderer or a test as the Spec to render.
