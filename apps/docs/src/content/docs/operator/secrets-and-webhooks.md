---
title: Secrets and webhooks
description: What goes in the platform environment, and the one post-deploy step.
---

| Variable                                                                          | Purpose                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `PRINTFUL_TOKEN`                                                                  | Printful API v2 token for the store                                   |
| `STRIPE_SECRET_KEY`                                                               | Stripe secret key (`sk_test_…` while rehearsing, `sk_live_…` to sell) |
| `OPERATOR_TOKEN`                                                                  | The Operator's credential for the CLI and the Operator View login     |
| `SESSION_SECRET`                                                                  | Signs the Operator View's session cookie                              |
| `ENGINE_SECRET_<SLUG>`                                                            | Shared secret per Engine (slug upper-cased, dashes to underscores)    |
| `RESEND_API_KEY`                                                                  | Customer emails through Resend; needs `email.from` in the config      |
| `CRON_SECRET`                                                                     | Vercel only: the bearer Vercel Cron sends to the reconciliation route |
| `STRIPE_WEBHOOK_SECRET`, `PRINTFUL_WEBHOOK_SECRET`, `PRINTFUL_WEBHOOK_PUBLIC_KEY` | Printed once by `pressline webhooks register`                         |

## Webhooks

Webhooks need the deployed URL, so they are registered after the first deploy:

```sh
npx @pressline/cli --url https://shop.example --token $OPERATOR_TOKEN webhooks register
```

It creates (or verifies) the Stripe endpoint for the checkout events and the Printful configuration for order and shipment events, prints the signing secrets **once**, and you store them in the platform and redeploy. Webhooks are hints: Pressline re-fetches the session or order from the provider before moving an Order, and the nightly Reconciliation catches anything a webhook missed.

Provider-side settings are in [Stripe](https://github.com/dworznik/pressline/blob/main/docs/operator/stripe.md) and [Printful](https://github.com/dworznik/pressline/blob/main/docs/operator/printful.md).
