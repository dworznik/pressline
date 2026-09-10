---
status: accepted
---

# Offers map to Printful catalog variants, never to sync products

An Offer holds a map from size/colour to Printful catalog `variant_id` plus a placement key and print technique; Pressline builds each order from `variant_id` + per-order `files[]`. We rejected Printful sync products (templates created in Printful's dashboard, referenced by `sync_variant_id` with files overridden per order) because they make product setup a dashboard step the one-click deploy cannot perform and the docs would have to screenshot, and because the Printfile Spec lookup is catalog-level anyway. The cost is that the Operator must discover catalog variant IDs, so the CLI provides a catalogue search that emits Offer config.

## Consequences

- The whole product setup is Pressline configuration; the Printful dashboard is only needed for billing and shipping settings.
- Supporting sync products later means a second Offer shape and a second order-building path; do not add it casually.
