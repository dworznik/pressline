---
title: Checking your Engine
description: "The Engine developer's commands: the conformance suite and the instance's Offers."
---

Both commands live in the `pressline` CLI and need no operator token.

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
