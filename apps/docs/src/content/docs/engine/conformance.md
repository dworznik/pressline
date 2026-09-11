---
title: Conformance suite
description: Run it against your Engine before wiring it to an instance.
---

```sh
npx @pressline/conformance https://engine.example --secret $ENGINE_SECRET --design <a design id>
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

The `printfile` check is Pressline's own validator from `@pressline/contract`, so what passes here passes in production. `--timeout` raises the wait for slow renderers; `--any-shape` skips the 422 check for Engines that pad any Spec. As a test helper, `conformance({ baseUrl, secret, designId, fetch })` returns the same report for an in-process handler; the sample Engine's test suite is exactly that.
