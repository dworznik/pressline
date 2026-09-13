---
title: JSON API (OpenAPI)
description: The public and operator endpoints, generated from the Effect HttpApi.
---

The instance serves its own description at `GET /api/openapi.json` (unauthenticated: it describes paths and schemas, never data); the copy generated at this site's build is at [`/openapi.json`](/openapi.json).

**Public** (the Storefront's own API, usable by a custom front): `GET /api/health`, `GET /api/offers` (the Catalog with Printfile Specs), `GET /api/designs/:engine/:designId`, `POST|GET /api/designs/:engine/:designId/printfile`, `GET /api/quote`, `GET /api/quotes/:id`, `POST /api/checkout`, `GET /api/orders/:id?t=<status token>`.

**Operator** (`Authorization: Bearer <OPERATOR_TOKEN>` or the session cookie from `POST /api/operator/session`; public reads in Demo Mode): health, orders, order detail, order actions, catalog tools, webhook registration, printfile check, reconcile and the last report.

The printfile check response carries the response facts and the file's whole [Inspection](/print/printfile/#what-pressline-checks-and-what-it-does-not): the complete parsed `header`, every refusal in `invalid`, and every `deviations` entry. Order detail carries the Inspection recorded when the Printfile was validated, snapshotted onto the Order at sale; it is absent on an Order placed before that was recorded. Both are additive and carry no version field, so a client reads what it knows and ignores the rest.

**Webhooks**: `POST /webhooks/stripe`, `POST /webhooks/printful`. **Cron**: `GET /api/cron/reconcile` with `CRON_SECRET`.
