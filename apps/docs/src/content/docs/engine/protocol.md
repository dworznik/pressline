---
title: The protocol
description: Three endpoints, one shared secret, and files you host.
---

An Engine is any HTTP service that serves, under a base URL the Operator configures:

|                                                          | Answer                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                            | `{ protocolVersion: "1" }`                                                                                                                                                        |
| `GET /designs/{id}`                                      | `{ id, title?, sellable, previewUrl, aspect: { w, h }, offers?, mockups?, engineRef? }` or 404 `DesignNotFound`                                                                   |
| `POST /designs/{id}/printfile` with a **Printfile Spec** | 200 `{ status: "ready", url, sha256, width, height, bytes, contentType, specHash }`, or 202 `{ status: "rendering", retryAfterMs }`, or 422 `PrintfileRejected { code, message }` |

Every request carries `Authorization: Bearer <shared secret>`. The exact schemas are the normative source in [`@pressline/contract`](https://github.com/dworznik/pressline/tree/main/packages/contract), which also ships a typed client and an Effect `HttpApi` you can implement directly.

A **Printfile Spec** is what Pressline derives from a Printful placement: `{ width, height, dpi, formats, colorSpace: "srgb", alpha: "allowed" | "forbidden" | "required", placement, technique }`. Its **Spec Hash** (`specHash(spec)` in the contract) together with the Design ID identifies exactly one Printfile and is the idempotency key: the same request must return the same URL and echo the same `specHash`.

- `aspect` is the design's own shape; Pressline hides Offers whose print area does not fit it, and your Engine answers 422 `aspect_mismatch` to a Spec it cannot honour.
- `offers` (Offer slugs) narrows which Offers the design may be sold on; omit it for "all".
- `mockups[offerSlug]` is an optional image of the design on that product, shown instead of Pressline's overlay.
- `sellable: false` stops new orders without deleting the design.
