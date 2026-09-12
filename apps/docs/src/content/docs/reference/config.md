---
title: Configuration
description: Every key of pressline.config.ts.
---

| Key                      | Meaning                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `currency`       | Shown everywhere; one ISO 4217 currency per instance                                                                                                     |
| `engines[]`              | `{ slug, baseUrl }`; secret in `ENGINE_SECRET_<SLUG>`                                                                                                    |
| `catalog.offers[]`       | `{ slug, name, catalogProductId, placement, technique, retailPrice, aspect?, variants: { key: { catalogVariantId, label, color?, size?, imageUrl? } } }` |
| `demo`                   | Demo Mode                                                                                                                                                |
| `branding`               | `{ logoUrl?, faviconUrl?, accent, accentText, tagline? }` — `faviconUrl` falls back to `logoUrl`, then to Pressline's own mark                           |
| `legal`                  | `{ withdrawalNotice, termsUrl?, privacyUrl?, contactEmail? }`                                                                                            |
| `email`                  | `{ from?, replyTo?, operator? }` — `from` together with `RESEND_API_KEY`; `operator` receives Alarms                                                     |
| `checkout`               | `{ allowPromotionCodes, publicUrl? }` — set `publicUrl` behind a proxy                                                                                   |
| `shipping.markupPercent` | On top of Printful's rate for the Customer's shipping line                                                                                               |
| `quote.ttlMs`            | How long a Quote can be checked out                                                                                                                      |
| `printfile.waitMs`       | How long one printfile request waits on a rendering Engine before answering 202                                                                          |

The schema (`apps/pressline/src/lib/server/config/schema.ts`) is the source of truth; boot fails with the offending key named.
