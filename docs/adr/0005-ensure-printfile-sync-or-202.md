---
status: accepted
---

# "Ensure Printfile" is a sync-or-202 call keyed by (Design ID, Spec Hash)

Pressline runs on Workers and Vercel where a blocking outbound call must finish in tens of seconds, yet some Engines (AI upscalers) render slowly. We decided the Engine's ensure-Printfile endpoint answers `200` with the Printfile URL when the file exists and `202` with a retry hint when it is still rendering; Pressline polls the same idempotent endpoint with a bounded wait and, if still not ready, returns `202` to the checkout page, which polls Pressline. There are no job IDs, callbacks or job tables on either side: `(Design ID, Spec Hash)` identifies the file, so "is it there yet" is the whole protocol.

## Considered options

- Sync only (rejected: excludes slow Engines when Pressline runs on Workers).
- Engine-to-Pressline callback webhook (rejected: a third authenticated inbound endpoint plus persisted job state, for one call).
- Browser asks the Engine directly and hands Pressline the URL (rejected: Pressline must never accept a Printfile URL it did not request, or anyone could order prints of arbitrary files through the Operator's Stripe account).

## Consequences

- The Printfile Spec must be canonically serialisable so both sides derive the same Spec Hash.
- Checkout entry must tolerate a "rendering, retry" state.
