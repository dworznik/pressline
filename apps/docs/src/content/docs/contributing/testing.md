---
title: Test seams and fixtures
description: Where tests go, and how to refresh recorded provider responses.
---

Four seams, highest first (`docs/SPEC.md → Testing Decisions`):

1. **HTTP surface of the bridge** with in-memory Engine, provider, PSP, Mailer, a settable Clock and a SQLite file: `apps/pressline/tests/*.test.ts` through `tests/harness.ts`. Full flows, idempotent and out-of-order webhooks, Demo Mode, every CLI action, every Reconciliation step. Playwright drives the Storefront pages on the same seam (`pnpm e2e`).
2. **Adapter contract tests** against recorded fixtures: `tests/printful-adapter.test.ts`, `stripe-adapter.test.ts`, `resend-adapter.test.ts` replay `tests/fixtures/<provider>/*.json` (file name = URL path with `/` → `_`).
3. **Render helper** by PNG headers: `packages/render/tests`, one suite against both backends.
4. **Conformance suite**: `packages/conformance/tests` against a fake Engine; the sample Engine runs the real suite in-process.

No module-level tests of the ledger; a test asserts what a caller can observe.

`pnpm verify` runs format, lint, typecheck, ADR check, tests and builds; CI runs the same plus the e2e job and the platform builds. Maintainers re-record fixtures from the live APIs with `pnpm --filter pressline fixtures:refresh` (needs `PRINTFUL_TOKEN` and a test-mode `STRIPE_SECRET_KEY`) and review the diff; the nightly live smoke (`test:live`) is what tells us an API changed shape.
