---
status: accepted
---

# Configuration lives in a typed file in the deployed repo; the operator view is read-only

The Catalog, Engines, branding, legal wording and currency live in `pressline.config.ts`, validated by `Schema` at boot; secrets live in the platform's environment. Changing a price or adding an Offer is a commit and a redeploy. We rejected database-held configuration edited in the operator view (needs forms, validation UI, a settings table and an admin bootstrap in the one-click deploy) and a hybrid with the Catalog in the database. The consequence we want: the one-click deploy is fork, set a handful of secrets, done; the catalog is version-controlled and auditable; and the operator view is a read-only page (orders, Transitions, Reconciliation results, health), which keeps its auth minimal.

## Consequences

- There is no settings page. Do not add one; edit the config and redeploy.
- The CLI's catalog search emits config snippets rather than writing to a database.
