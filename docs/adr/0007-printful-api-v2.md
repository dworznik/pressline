---
status: accepted
---

# Target Printful API v2 only, and still treat webhooks as hints

As of September 2026 Printful API v2 is Open Beta (usable on live accounts, minor changes possible) and v1 is stable with no announced sunset. We chose v2 only: its catalog endpoints return per-placement printfile dimensions and DPI, which is the source of Pressline's Printfile Spec, and its webhooks are signed and expiring. The beta risk is contained behind the `FulfilmentProvider` interface, and it is tolerable because Pressline never acts on a webhook payload as truth: every webhook, signed or not, triggers a re-fetch of the order from Printful before the ledger changes. We rejected v1 (unsigned webhooks, printfile dims via a legacy endpoint) and a v1+v2 mix (two clients, two doc sets).

## Consequences

- Webhook signature verification is defence in depth, not the idempotency mechanism.
- If a v2 field changes, only the adapter changes; the order ledger schema must not mirror v2 payloads.
