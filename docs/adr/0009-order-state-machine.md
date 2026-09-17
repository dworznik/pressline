---
status: accepted
---

# The Order exists from Checkout creation, and the state machine has no delivered or partial states

An Order row is created when the Stripe Checkout session is created, so a single Pressline Order ID rides in Stripe (`client_reference_id`/metadata) and becomes Printful `external_id`; reconciliation is then a three-way join on one key rather than a heuristic match. We rejected creating the Order only on payment with a separate short-lived Checkout record (a second table with its own expiry sweep).

States: `checkout_open → expired | paid`; `paid → submitted | submit_failed`; `submitted → in_production | on_hold`; `on_hold → submitted | in_production`; `in_production → shipped → fulfilled`; any non-terminal `→ canceled`; `→ refunded` from any state after payment, `fulfilled` included (amended 2026-09-11: Reconciliation records a refund wherever the Order is, since a goodwill refund after delivery is a fact the ledger must hold; it alarms the Operator to cancel at the provider when the goods have not shipped). Terminal: `expired`, `fulfilled`, `canceled`, `refunded`.

## Considered options

- A `delivered` state (rejected; reason corrected 2026-09-17 by #100). The original reason — "Printful does not report delivery reliably" — is false against API v2, which publishes a `shipment_delivered` event, a `delivery_status` enum and a `delivered_at` timestamp. The reason we decline today is that `delivery_status`'s first value is `unknown`: a state we cannot always reach would leave Orders sitting in `shipped` forever, which is the failure the original decision avoided. ADR-0015 lists a delivered state among v1's exclusions, so reversing this needs its own ADR rather than an amendment here.
- Partial-shipment states (rejected: single-item orders, so Printful `partial` collapses into `shipped`).
- No `refunded` state (rejected: Reconciliation must be able to record a refund the Operator issued in the Stripe dashboard, even though Pressline ships no refund tooling).

## Consequences

- `paid` is the only state where money is held without a provider order; Reconciliation alarms on a `paid` Order older than a threshold.
- `submit_failed` and `on_hold` are the states the CLI's resubmit and cancel commands act on.
- Provider statuses map onto these states, never the other way round (amended 2026-09-12): `pending`/`inreview` → `submitted`, `onhold` → `on_hold`, `inprocess` → `in_production`, `partial` → `shipped`, `fulfilled` → `fulfilled`, `canceled` → `canceled`. A provider `failed` is `submit_failed` only before confirmation; once the Order is `submitted` or beyond, `failed` (payment not taken, a file rejected late) is the Operator's to sort out, so it maps to `on_hold`, with the reason on the Transition and a Reconciliation alarm. Retrying at the provider moves it back through `pending` → `submitted`. When the Order is already `on_hold`, the failure is recorded as a same-state Transition row carrying the reason, written once per reason: the state machine has no self-edges, but the ledger must still hold the fact.
- Every Transition records its Cause (see CONTEXT.md).
- `paid → submitted` is draft-then-confirm on the provider, and every submit attempt begins with a lookup by `external_id` so the paid-webhook handler is safely re-runnable. The draft's cost delta against the Provider Cost Estimate is logged, not enforced; only a variant or destination-country mismatch blocks confirmation.
- **Which provider events we subscribe to** (added 2026-09-17 by #93, #99, #100): we subscribe to the events that can move the ledger, and to nothing else. Everything a provider publishes that cannot produce a Transition is deliberately ignored and named below with its reason, so an absence is a decision on the record rather than an oversight. Adding an event changes the endpoint's registered event list, so existing instances must re-register before the new event arrives.

  From Stripe we take `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `checkout.session.async_payment_failed` (the last pending #93). We ignore `charge.refunded` and the five `charge.dispute.*` events, because Reconciliation owns refunds and disputes inside its 90-day window and a webhook would make two paths to one fact; and `payment_intent.payment_failed`, because a card decline leaves the session `open`, which is the Customer's to retry.

  From Printful we take `order_created`, `order_updated`, `order_failed`, `order_canceled`, `order_put_hold`, `order_put_hold_approval`, `order_remove_hold`, `order_refunded`, `shipment_sent`, `shipment_returned` and `shipment_canceled` (`order_put_hold_approval` and `order_refunded` pending #99). We ignore `approval_sheet_status_changed`, because approving a sheet is the Operator's to do in Printful and the hold itself already moves the ledger; `shipment_delivered`, because there is no delivered state (above, and ADR-0015); `shipment_out_of_stock`, `shipment_put_hold`, `shipment_put_hold_approval` and `shipment_remove_hold`, because an Order is single-item, so an item-level hold reaches us as the order-level hold we already handle — **if Orders ever stop being single-item, that reason expires with them**; and `catalog_stock_updated`, `catalog_price_changed` and `mockup_task_finished`, excluded by ADR-0015.

- Webhooks can be missed, so the machine also allows skipping forward past intermediate states the provider has already passed (`submitted → shipped`, `submitted → fulfilled`, `in_production → fulfilled`), a hold during production (`in_production → on_hold`), and the operator's resubmit (`submit_failed → submitted`). Reconciliation relies on the first of these.
