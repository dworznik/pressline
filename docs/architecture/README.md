# PROTOTYPE: container view granularity (#64)

Throwaway LikeC4 model built to answer one wayfinder question: how fine-grained is the
container view? Nothing here lands on `main` from map #61. Run `pnpm proto:c4` at the
repo root and compare the three container views.

Assumptions baked in so the boxes have edges to react to (not decisions):

- DesignSource calls are drawn from the Storefront (fetch the Design) and the HttpApi
  (request and validate the Printfile).
- Customer emails are sent from the webhook receivers; Alarms from Reconciliation.
- The ledger is a platform binding (D1 / Turso / file), so it sits beside the SvelteKit
  app rather than inside it.
