---
title: What Pressline is
description: A self-hostable bridge from an image-generating app to physical print-on-demand products.
---

Pressline sits between an app that makes images (an **Engine**) and a printed, shipped product. The Engine keeps its design tool; Pressline does the rest: product choice, a locked **Quote**, Stripe Checkout, the Printful order, customer emails, a ledger the **Operator** can read, and a nightly **Reconciliation** that repairs whatever a webhook missed.

- One Operator per instance, one typed config file, secrets in the platform. No Shopify, no accounts, no carts.
- Engines implement a three-endpoint protocol and host their own files; Pressline never touches pixels.
- Deploys to Cloudflare Workers (D1) or Vercel (Turso) with a button, or anywhere Node runs.

**Operators** start at [Deploy](/operator/deploy/). **Engine developers** start at [The protocol](/engine/protocol/). The glossary every page uses is [`CONTEXT.md`](https://github.com/dworznik/pressline/blob/main/CONTEXT.md); the reasons behind the constraints are the [ADRs](https://github.com/dworznik/pressline/tree/main/docs/adr).
