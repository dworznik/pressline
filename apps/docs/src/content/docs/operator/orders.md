---
title: Orders and reconciliation
description: The ledger, the Operator View, the CLI actions, and the nightly truth pass.
---

Every Order is a row plus append-only **Transitions**, each with a **Cause** (`storefront`, `stripe_webhook`, `printful_webhook`, `cli`, `reconciliation`). The table below is every move the state machine allows.

## Transitions

Mirrored by hand from [`apps/pressline/src/lib/server/orders/state.ts`](https://github.com/dworznik/pressline/blob/main/apps/pressline/src/lib/server/orders/state.ts), which is the source of truth (ADR-0009). Each row is a state and the states it may move to. The [Order flow](/architecture/order-flow/) view walks the happy path; the [Reconciliation](/architecture/reconciliation/) view shows how a missed webhook is caught up.

| State           | May move to                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `checkout_open` | `expired`, `paid`, `canceled`                                              |
| `paid`          | `submitted`, `submit_failed`, `canceled`, `refunded`                       |
| `submit_failed` | `submitted`, `canceled`                                                    |
| `submitted`     | `in_production`, `on_hold`, `shipped`, `fulfilled`, `canceled`, `refunded` |
| `on_hold`       | `submitted`, `in_production`, `canceled`, `refunded`                       |
| `in_production` | `shipped`, `fulfilled`, `on_hold`, `canceled`, `refunded`                  |
| `shipped`       | `fulfilled`, `canceled`, `refunded`                                        |
| `expired`       | none                                                                       |
| `fulfilled`     | `refunded` (a goodwill refund can still be recorded after fulfillment)     |
| `canceled`      | `refunded`                                                                 |
| `refunded`      | none                                                                       |

`expired`, `fulfilled`, `canceled` and `refunded` are terminal for fulfillment: nothing more will ship, and `orders purge` may strip personal data.

The **Operator View** (`/operator`, log in with the operator token) is read-only: health, orders, one order's Transitions, Inbound Events and emails, the last Reconciliation report. Actions are the CLI's:

```sh
pressline orders list --state submit_failed
pressline orders show <id>
pressline orders resubmit <id>
pressline orders fix-address <id> --name … --address1 … --city … --country DE --email …
pressline orders cancel <id>                # cancels at Printful while it still can; never refunds
pressline orders create --engine sample --design <id> --offer … --variant … --paid-outside --name … …
pressline orders purge --older-than 90     # strips personal data from finished orders
pressline reconcile [--dry-run]
```

**Reconciliation** runs nightly (and on demand): stale checkouts verified at Stripe, stuck `paid` orders resubmitted, provider status caught up, refunds and disputes recorded, unprocessed webhooks replayed, failed emails retried, Engines re-checked, the Catalog refreshed. Every repair is a Transition with Cause `reconciliation`; Alarms are emailed to `email.operator` only when there are any. Details: [reconciliation](https://github.com/dworznik/pressline/blob/main/docs/operator/reconciliation.md).
