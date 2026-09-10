---
status: accepted
---

# pnpm monorepo; the bridge is a deployable, not a published library

The repo is a pnpm workspace with `apps/` (pressline, sample-engine, docs), `packages/` (`@pressline/contract`, `@pressline/render`, `@pressline/cli`, all published to npm) and `deploy/` (Cloudflare and Vercel one-click templates pointing at `apps/*`). We deliberately do not publish the bridge itself as `@pressline/core`: that would create a public embedding API to semver for a use-case nobody has asked for, and the product is the deployable. Operators customise by deploying the app and using its JSON API, not by importing it.

## Consequences

- `@pressline/contract` is the only package Engine developers must depend on; it carries the DesignSource Schemas, the Printfile Spec and Spec Hash, and the generated HTTP client.
- Anything an Engine needs at runtime must live in `contract` or `render`, never be reached into from `apps/pressline`.
