# Reconciliation

Webhooks are hints; Reconciliation is the truth pass (ADR-0007, ADR-0009). Every run compares open Orders with Stripe and Printful, repairs what a missed webhook left behind (each repair is a Transition with Cause `reconciliation`), and raises Alarms for anything that needs you.

## What a run does

| Step                 | Looks at                                | Repairs                                                     | Alarms                           |
| -------------------- | --------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `staleCheckouts`     | `checkout_open` older than 24 h         | paid at Stripe → settled and submitted; otherwise `expired` | —                                |
| `stuckPaid`          | `paid` older than 15 min                | submitted to Printful again                                 | still not submitted              |
| `providerCatchUp`    | `submitted`, `in_production`, `on_hold` | state moved to what Printful reports                        | on hold, `submit_failed`         |
| `refundsAndDisputes` | every Order with a payment              | refunded at Stripe → `refunded`                             | every refund and dispute         |
| `inboundEvents`      | Inbound Events never settled            | reprocessed                                                 | —                                |
| `emails`             | failed Customer emails                  | sent again                                                  | failed 5 times                   |
| `engines`            | every Engine's `/health`                | re-enabled when back                                        | still disabled                   |
| `catalogue`          | the Catalogue cache                     | refreshed from Printful                                     | an Offer that no longer resolves |

The report of the last run is on **Operator → Reconciliation**, where you can also run one now.

## Alarm email

Set `email.operator` in `pressline.config.ts`. A run with Alarms emails that address through the Mailer; a quiet run sends nothing.

## Scheduling

- **Vercel**: point a cron at `GET /api/cron/reconcile`; Vercel sends `Authorization: Bearer $CRON_SECRET`, so set `CRON_SECRET` in the project's environment. The Vercel deploy template (#24) ships the `vercel.json` entry.
- **Cloudflare**: a Cron Trigger invokes the Worker's `scheduled` export, which runs the same entry in-process; the Cloudflare deploy template (#23) wires it. No secret needed.
- **Anywhere else**: `POST /api/operator/reconcile` with the operator bearer token, or `pressline reconcile` from the CLI (`--dry-run` to see what a run would do without changing anything).
