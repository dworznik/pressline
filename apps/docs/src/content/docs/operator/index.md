---
title: Operator guide
description: Deploy an instance, configure it, take it live, and run it day to day.
---

You are the **Operator** if you run an instance: one shop, one Printful account,
one Stripe account, one config file you edit and redeploy. There are no user
accounts and no admin UI that writes anything — the Operator View is read-only
and every action is a CLI command against your own instance.

Read these in order the first time.

- **[Deploy](/operator/deploy/)** — one deployable per platform. Cloudflare with
  D1, Vercel with Turso, or anywhere that runs Node with a SQLite file.
- **[Configure](/operator/configure/)** — `pressline.config.ts`: the shop name,
  the currency, the Engines you trust, and the Catalog of things you sell. It is
  a typed file in your repo, so a bad config fails at boot rather than at
  checkout.
- **[Secrets and webhooks](/operator/secrets-and-webhooks/)** — what goes in the
  platform's environment, and registering the Stripe and Printful endpoints.
- **[Demo Mode](/operator/demo-mode/)** — run the whole flow with no money and no
  goods moving, so you can see a real order without paying for one.
- **[Go live](/operator/go-live/)** — the checklist, and `pressline doctor` as the
  thing that tells you whether you are ready.

Then, once orders are arriving:

- **[Orders and reconciliation](/operator/orders/)** — the ledger, every state an
  order can be in, the CLI actions, and the nightly pass that repairs whatever a
  webhook missed.
- **[Legal wording and personal data](/operator/legal/)** — the withdrawal notice
  you must show, and how long recipient details are kept. Read it with counsel;
  the shipped wording is a template, not advice.
