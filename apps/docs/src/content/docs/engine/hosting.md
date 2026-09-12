---
title: Pre-rendering and hosting
description: Immutable public URLs, unguessable IDs, and rendering before the Customer waits.
---

Pressline never stores image bytes. It hot-links your Preview and validates your Printfile by reading its header with one ranged GET, so:

- **URLs are public and immutable.** A Printfile URL for a (Design, Spec Hash) pair never changes content. Put files under a content-addressed key (the sample uses `printfiles/<designId>/<specHash>.png`) in R2, Vercel Blob, S3 or your own disk; serve `Range` requests if you can (Pressline reads at most 64 KiB).
- **Design IDs are unguessable**: 8–128 characters of `[A-Za-z0-9_-]`, random. Anyone with the ID can see the Preview.
- **Pre-render on finalize.** Fetch `GET /api/offers` from the Pressline instance: every Offer and variant comes with its Printfile Spec. Render a Printfile per Spec while the Customer is still in your app and checkout never waits; a Spec you cannot render (aspect, budget) makes that Offer ineligible via `offers`.
- **Sync or 202.** If a render takes longer than a request, answer `202 { retryAfterMs }` and finish in the background; Pressline polls, and the Storefront tells the Customer to wait. Answering 200 synchronously is fine when rendering is fast.
- Pressline verifies: dimensions equal the Spec, format allowed, alpha per the Spec, `specHash` echoed, `Content-Type` and size as declared.

The [sample Engine](https://github.com/dworznik/pressline/tree/main/apps/sample-engine) does all of this in a few hundred lines.
