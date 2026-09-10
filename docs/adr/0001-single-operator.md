---
status: accepted
---

# Pressline is single-operator, not multi-tenant

Pressline is deployed by one Operator who owns the Engine(s), the Printful account and the Stripe account. Engines are trusted and authenticate with a shared secret configured at deploy time. We considered a multi-tenant hub (many independent Engine developers, per-tenant credentials, Stripe Connect) and a "single-operator now with a reserved tenant column" middle path, and rejected both: multi-tenancy brings Connect, KYC, tenant isolation and an admin surface that would triple v1, and a reserved tenant column is speculative generality that taxes every query. Anyone wanting many independent shops deploys many instances.

## Consequences

- No `tenant_id` anywhere. Do not add one "just in case".
- "Any image-generating app" means any app the Operator controls can plug in, not open registration.
