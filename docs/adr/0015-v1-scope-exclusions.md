---
status: accepted
---

# What v1 deliberately excludes

Pressline v1 sells one Offer bearing one Design per Order to a guest Customer, in one currency, through Printful and Stripe only. The following are excluded on purpose, each because it would add a state, a table, a UI or a provider integration that the single-operator, defects-only-returns model does not need:

- Multi-item carts (Order is single-item; the state machine depends on it).
- Customer accounts and saved addresses (guest checkout; Stripe collects the Recipient).
- Refund tooling and Customer-initiated cancellation (the Operator refunds or cancels in the Stripe/Printful dashboards or via the CLI; Reconciliation records the result; the confirmation email tells the Customer how to reach the Operator quickly).
- Discount codes beyond flipping Stripe's `allow_promotion_codes` in config.
- Additional fulfillment providers or PSPs (interfaces exist, one implementation each).
- An embeddable checkout widget (entry is a redirect to the Storefront; extension is the JSON API).
- Printful mockup generation in core, Printful sync products, multi-currency, a settings UI, multi-tenancy, digital or non-shipped goods, a delivered state.

## Consequences

- Any of these can be proposed later, but each must come with its own ADR; none may be "quietly" added.
