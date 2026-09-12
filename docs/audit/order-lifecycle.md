# Order lifecycle audit: Stripe and Printful

Audited 2026-09-13 against the providers' own documentation, for ticket #85. The
prompt for it was a run of bugs found by walking the first real Order through a
live instance (#75, #76, #83, #84), none of which the test suite could have
caught.

**How to read.** Each table is one provider fact, what our code does with it,
and what proves it. "Gap" links a sub-issue of #85. A row with no gap is a
claim we checked and found sound; those are worth as much as the failures,
because they are the ones nobody needs to look at again.

**Confidence.** Every provider claim here comes from the provider's own docs and
is linked. Where their documentation is silent, the row says **undocumented**
and, if we tested it against the live API, what we observed. Empirical findings
are marked as such: they are true of Printful today, not promises.

## Stripe Checkout

We create a hosted Checkout Session per Order and never hold card data. Source:
[Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object),
[events](https://docs.stripe.com/api/events/types),
[webhooks](https://docs.stripe.com/webhooks).

### Session state

| Stripe says                                                                                                                | Our handling                                                                                                              | Proof                                                                 | Gap |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --- |
| `status` is `open`, `complete` or `expired`. `complete` explicitly means "Payment processing **may still be in progress**" | We never treat `complete` as money. `applyPaid` returns `ignored` when `payment_status` is `unpaid`                       | `stripe-webhook.test.ts`, "never acts on the delivery body"           | —   |
| `payment_status` is `paid`, `unpaid` or `no_payment_required`                                                              | All three handled; `no_payment_required` (a fully discounted session) counts as paid                                      | `stripe-webhook.test.ts`, "treats a fully discounted session as paid" | —   |
| Default expiry 24 h, settable 30 min to 24 h. An expired session cannot be paid                                            | We do not set `expires_at`, so 24 h. `staleCheckouts` sweeps `checkout_open` at 24 h and asks Stripe rather than assuming | `reconciliation.test.ts`                                              | —   |
| Only an `open` session can be expired via the API                                                                          | `expireCheckoutSession` is called on the Operator's cancel path                                                           | `operator-actions.test.ts`                                            | —   |

### Events

We subscribe to exactly three, and the endpoint is registered with exactly
those (`STRIPE_WEBHOOK_EVENTS`).

| Event                                      | Carries                 | Our handling                                                                               | Gap |
| ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------ | --- |
| `checkout.session.completed`               | Session                 | Re-fetch, then `checkout_open → paid`, submit, email                                       | —   |
| `checkout.session.async_payment_succeeded` | Session                 | Same path as completed                                                                     | —   |
| `checkout.session.expired`                 | Session                 | `checkout_open → expired`                                                                  | —   |
| `checkout.session.async_payment_failed`    | Session                 | **Not subscribed.** A declined delayed payment is invisible until the 24 h sweep           | #93 |
| `charge.refunded`                          | **Charge**, not Refund  | Not subscribed; refunds are polled instead (below)                                         | #92 |
| `charge.dispute.*` (5 events)              | **Dispute**, not Charge | Not subscribed; disputes are polled as one boolean                                         | #95 |
| `payment_intent.payment_failed`            | PaymentIntent           | Not subscribed. A card decline leaves the session `open`, which is the Customer's to retry | —   |

Delayed-notification methods (ACH, SEPA, Bacs, Boleto, Konbini, OXXO and
friends) complete the session `unpaid` and settle 2 to 14 days later. Our flow
holds the Order at `checkout_open` throughout, which is what Stripe's own
fulfilment guidance asks for.

### Refunds and disputes

Recorded by Reconciliation polling `getPaymentStatus`, not by webhook, within a
90-day window (`REFUND_WINDOW_MS`).

| Stripe says                                                                                                                                     | Our handling                                                                                                                      | Gap |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --- |
| On a **partial** refund, `charge.refunded` stays `false`; `amount_refunded` is the only signal                                                  | We gate on the boolean, so a partial refund produces no Transition and no Alarm. **Proven**, not inferred                         | #92 |
| A dispute has 8 states; an inquiry withdraws no funds, a chargeback does, and a late win can reverse a loss                                     | Reduced to `disputed: boolean`, so an inquiry, a loss and a win look identical, and the Alarm most likely repeats nightly forever | #95 |
| "You can't issue a refund outside the dispute process while the dispute is open"                                                                | Not encoded anywhere; the Operator refunds in Stripe, so this is theirs to know                                                   | —   |
| ACH can produce a **dispute after `succeeded`**, up to 60 days, reasons `insufficient_funds`, `incorrect_account_details`, `bank_can't_process` | Our 90-day poll window covers it, but see #95 for what we can tell the Operator about it                                          | #95 |

## Printful (API v2)

We create a draft, wait for pricing, confirm, then follow the order by webhook
and by Reconciliation catch-up. Source:
[v2 beta docs](https://developers.printful.com/docs/v2-beta/),
[v1 docs](https://developers.printful.com/docs/) for the parts v2 still defers
to, Help Center where cited.

### Order status

Printful documents nine statuses in prose and **publishes no state machine**;
the `status` field has no enum in their OpenAPI, so the list is not
machine-checkable and may not be exhaustive.

| Printful status      | Means                                                                               | Our ledger state                                           | Gap |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | --- |
| `draft`              | Created, not charged, freely editable                                               | (none: we confirm immediately)                             | —   |
| `pending`            | Confirmed and charged, not yet accepted                                             | `submitted`                                                | —   |
| `inreview`           | Under review. **The v2 spec contradicts itself** on whether it is still cancellable | `submitted`                                                | —   |
| `failed`             | Address, printfile or **wallet charge** problem. Re-confirmable                     | `submit_failed` before confirmation, `on_hold` after (#84) | —   |
| `onhold`             | Needs resolving with Printful. **Auto-cancelled and refunded after 30 days**        | `on_hold` + Alarm                                          | #99 |
| `inprocess`          | Being fulfilled, no longer cancellable                                              | `in_production`                                            | —   |
| `partial`            | Some items shipped                                                                  | `shipped`                                                  | —   |
| `fulfilled`          | All items shipped                                                                   | `fulfilled`                                                | —   |
| `canceled`           | Cancelled; charge returned to the store                                             | `canceled`                                                 | —   |
| `archived` (v1 only) | Hidden from the UI                                                                  | Unknown to us, so `ignored` rather than a wrong move       | —   |

### Events

Printful publishes **20** webhook events. We subscribe to nine.

| Event                                                                                                     | Our handling                                                                                                                     | Gap  |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `order_created`, `order_updated`, `order_failed`, `order_canceled`, `order_put_hold`, `order_remove_hold` | Verified, recorded, re-fetched, then transitioned (ADR-0007)                                                                     | —    |
| `shipment_sent`, `shipment_returned`, `shipment_canceled`                                                 | Tracking captured; `shipment_sent` during `inprocess` means shipped                                                              | —    |
| `order_put_hold_approval`, `approval_sheet_status_changed`                                                | **Not subscribed.** A hold awaiting the Operator's approval arrives only as a generic update, with no reason and no 30-day clock | #99  |
| `order_refunded`                                                                                          | **Not subscribed.** The 30-day auto-cancel refunds to the Wallet and we learn only via `order_canceled`                          | #99  |
| `shipment_delivered`, `delivery_status`, `delivered_at`                                                   | **Not used.** ADR-0009 rejected a `delivered` state because "Printful does not report delivery reliably", which v2 contradicts   | #100 |
| `shipment_out_of_stock`, `shipment_put_hold`, `shipment_remove_hold`                                      | Not subscribed                                                                                                                   | #99  |
| `catalog_stock_updated`, `catalog_price_changed`, `mockup_task_finished`                                  | Deliberately out of scope (ADR-0015)                                                                                             | —    |

### Drafts, confirmation and cancellation

| Printful says                                                                                                                                                                                                                                                      | Our handling                                                                                                                                                                                                                                                                                                                    | Gap      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Costs calculate **asynchronously**; while `calculation_status` is `calculating` every money field including `currency` is `null`                                                                                                                                   | Wire schema accepts nulls; `submit` polls for about 7 s before confirming, and answers `retry_later` if still calculating                                                                                                                                                                                                       | —        |
| An order **cannot be confirmed** while costs are calculating or have failed. The exact error is **undocumented**                                                                                                                                                   | We match on the message text, and treat that 400 as retryable                                                                                                                                                                                                                                                                   | —        |
| `external_id` limits are documented **only for v1**: 32 characters, and unique per store. v2's schema states no constraints                                                                                                                                        | We strip the UUID's hyphens to 32 and restore them on the way back (#76)                                                                                                                                                                                                                                                        | —        |
| Whether a deleted order's `external_id` is released is **undocumented**. It never is, for a canceled order either                                                                                                                                                  | Fixed: the external id carries a submission attempt. Attempt 0 is the plain Order ID without hyphens (32 characters, and what pre-#77 Orders carry); a later attempt encodes the same Order ID in base64url, which is exactly Printful's charset, and appends the attempt. Reversible, so a webhook still resolves to the Order | #77      |
| Confirmation may be accepted **before** the file is processed; an invalid file later reverts the order to `failed`                                                                                                                                                 | Handled by #84's mapping: a post-confirmation `failed` becomes `on_hold` with the reason                                                                                                                                                                                                                                        | —        |
| v2's docs warn `DELETE /v2/orders/{id}` **deletes**, and say to cancel through the **v1** route. **Empirically it archives**: after a 204 the order is gone from every v2 read, but v1 still returns it with `status: archived`, and its `external_id` stays taken | Fixed: the cancel path now calls v1, which genuinely cancels a draft or a pending order. This is also the root cause of #77                                                                                                                                                                                                     | #97, #77 |
| Rate limit 120 requests per 60 s, `retry-after` on 429, with lower limits for shipping rates and the mockup generator                                                                                                                                              | 429 is retryable but `retry-after` is ignored and the headers are unread                                                                                                                                                                                                                                                        | #98      |
| All Orders v2 endpoints still return the **legacy** error body, not RFC 9457                                                                                                                                                                                       | Our `ErrorWire` parses the legacy shape                                                                                                                                                                                                                                                                                         | —        |

## Checked and found sound

Worth recording so they are not re-audited.

- **Our Printful replay window covers their retries.** Printful retries after 1,
  4, 16, 64, 256 and 1024 minutes, so the last attempt lands about 17 h out. We
  reject deliveries whose `occurred_at` is older than 24 h, leaving roughly 7 h
  of margin.
- **Our Stripe handler has no event-age rejection, and should not.** Stripe
  retries for up to three days but regenerates the signature and timestamp on
  every attempt, so the 300 s tolerance applies to the delivery rather than the
  event. A 24 h window like Printful's would have rejected two days of retries.
- **Lookup by external id works.** v2 publishes no `@`-prefixed route, but it
  exists: a draft created with an `external_id` was fetched back through
  `GET /v2/orders/@{external_id}` during this audit. The submit idempotency step
  (ADR-0009) genuinely finds an existing order rather than silently always
  creating. Undocumented, so worth a contract test rather than trust.
- **Immutable Printfile URLs are the right shape for Printful's file cache.**
  Printful keys its file library on the URL and, on a repeat, "returns the old
  one **without refreshing its contents**". Our URLs are content-addressed by
  design id and Spec Hash (ADR-0003), so an identical URL really does mean
  identical bytes.
- **`complete` is never treated as paid**, which is exactly Stripe's own
  guidance for delayed-notification methods.
- **A cancelled order stays visible to v2; an archived one does not.** After the
  v1 cancel, `GET /v2/orders/{id}` and `GET /v2/orders/@{external_id}` both
  answer 200 with `status: canceled`, so `submit`'s idempotency lookup finds it
  and fails legibly instead of colliding blindly. Neither a cancelled nor an
  archived order ever releases its `external_id`, so a resubmission needs a
  fresh one (#77).
- **v2's DELETE archives rather than deletes**, which their own docs get wrong.
  Tested during this audit: a draft created with an `external_id`, deleted with a
  204, then read back. v2 answers 404 by internal id and by external id, while v1
  returns the order with `status: archived`, and creating again with the same
  `external_id` fails with "already used by store". That is the whole of #77: the
  order was never gone, only hidden from v2.

## Open questions

Neither provider documents these; they need an experiment or a support answer
before anything is built on them.

1. Printful's legal transition graph. Only per-status prose exists.
2. Whether `inreview` is cancellable. The v2 spec says both things in one file.
3. Whether placement validation (`status`, `status_explanation`) is populated in
   the create response or only later.
4. Whether cancelled orders are listed by `GET /v2/orders`. (The other half of
   this question — whether a hard-deleted order 404s — is answered above: there
   is no hard delete.)
5. Printful webhook ordering, at-least-once and deduplication guarantees. None
   are stated; only `retries` and the backoff.
6. Whether Printful follows redirects when fetching a Printfile, its timeout,
   and which size limit binds the order path. Three numbers are documented and
   none is tied to an order: 200 MB and 20 000 × 20 000 px for the File
   library, and 50 MB for the mockup generator. Sourced in the Printfile
   requirements audit (#108), which lands with #87.
7. Whether Stripe's `charge.disputed` stays true after a win. This decides
   whether #95 is noisy or merely thin.
8. Whether a Stripe test clock affects Checkout Session expiry. The feature is
   documented for Billing only.

## Gaps

Each is a sub-issue of #85 carrying the provider reference, the current
behaviour, a proposed fix and the test that would prove it.

| #    | Gap                                                                           |
| ---- | ----------------------------------------------------------------------------- |
| #92  | A partial refund was invisible: no Transition, no Alarm. **Fixed**            |
| #93  | `checkout.session.async_payment_failed` is not subscribed                     |
| #94  | Checkout Session creation sends no `Idempotency-Key`                          |
| #95  | Disputes are a single boolean; the Alarm likely repeats forever               |
| #97  | We could not cancel a confirmed Printful order: v2 DELETE archives. **Fixed** |
| #77  | A resubmit after cancellation needed a fresh external id. **Fixed**           |
| #98  | Printful 429 ignores `retry-after`                                            |
| #99  | Approval holds, refunds and several shipment events are unsubscribed          |
| #100 | ADR-0009's "Printful does not report delivery" premise is now false           |

Still open from before the audit: #77 (a deleted draft's `external_id` stays
reserved), #78 (Review Mode), #87 (Printfile validation checks less than the
docs promise).
