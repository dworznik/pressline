---
title: Engine developer guide
description: Build the app that makes the images, and speak the DesignSource protocol.
---

An **Engine** is your app: whatever makes the image a customer wants printed, be
it a template editor, a generative model, or a drawing tool. Pressline does not
care how the image happens. It cares that you can answer three questions about a
design and host the files you produce.

The division is deliberate and load-bearing. **The Engine owns pixels; Pressline
never renders, decodes or stores image bytes.** It reads your file's header to
check it matches the Spec, then hands the provider your URL. That is why your
files must stay reachable and unchanged for as long as an order might reference
them.

- **[The protocol](/engine/protocol/)** — the three endpoints, the Printfile Spec
  Pressline derives from the provider, and the Spec Hash that identifies exactly
  one file. Start here.
- **[Pre-rendering and hosting](/engine/hosting/)** — why rendering at Finalize
  beats rendering at checkout, what Pressline validates when it fetches your
  file, and the rules your URLs must obey.
- **[Rendering with @pressline/render](/engine/render/)** — an optional helper
  that produces a file satisfying a Spec: exact dimensions, DPI stamped, sRGB
  declared, alpha per the rule. Works on Node and on Workers.
- **[The Printfile format in detail](/print/printfile/)** — if you render with
  your own tools instead: every chunk and marker the file must carry, and what
  Pressline checks before payment.
- **[Checking your Engine](/engine/conformance/)** — run the conformance suite
  against your Engine before you wire it to anything, and list the Offers and
  Specs an instance will ask you for.
- **[AI-assisted Engines](/engine/ai/)** — what changes when a render takes
  thirty seconds instead of thirty milliseconds.

If you want a worked example rather than a specification, the repository's
`apps/sample-engine` is a small, complete Engine built to be copied.
