---
status: accepted
---

# A validated Printfile must exist before payment is taken

The DesignSource render call is a single idempotent "ensure a Printfile exists for (Design, Printfile Spec) and return its URL". Pressline makes it, and validates the result, before creating the Stripe Checkout session. The intended pattern is that the Engine pre-renders when a design is finalised in its own UI (fetching the Printfile Spec from Pressline), so the call is usually instant; when it has not, the Customer waits once, before paying. We rejected rendering after payment (fast for the Customer, but "we took your money and the file was bad" is the worst failure in a defects-only-returns business and forces refund tooling into v1) and rendering during Checkout (adds a `needs_printfile` parked state and retry machinery for a marginal latency win).

## Consequences

- No order can reach `paid` without a validated Printfile URL already recorded on it.
- Abandoned checkouts cost the Engine a render; pre-rendering is the mitigation, and the Engine docs recommend it.
