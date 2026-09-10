---
status: accepted
---

# Fixed retail prices per Offer, live shipping, and all product choice on a Pressline Storefront

The Engine's UI is for playing with designs and shows no prices. When a Customer wants a print they leave the Engine for a Pressline-hosted Storefront, choose the Offer (product family), its variant (size/colour) and destination country, and receive a Quote: the Offer's Operator-set retail price plus the shipping rate Printful returns for that variant and country, with tax added by Stripe Automatic Tax. The Stripe Checkout session is created with those amounts and its allowed shipping countries locked to the quoted one, so the Customer's price never floats after the Quote. Printful's product and shipping cost are stored on the Order as a Provider Cost Estimate for margin reporting only; a later difference on the Printful invoice is absorbed by the Operator, never re-charged.

## Considered options

- Cost-plus pricing computed live from Printful cost (rejected: prices float with Printful's catalogue).
- Flat shipping configured per Offer or region (rejected: dishonest across countries, and Printful rates are one call away).
- Collecting country inside Stripe and re-quoting shipping afterwards (rejected: Stripe Checkout cannot adjust a session's amounts after the Customer has entered it without a second charge).

## Consequences

- The country step must happen on the Storefront before the Stripe session exists.
- Checkout entry from the Engine is a hand-off to the Storefront, not a price-bearing widget.
