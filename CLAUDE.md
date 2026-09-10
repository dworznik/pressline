# Pressline

## Agent skills

### Issue tracker

Issues and specs are GitHub issues, driven with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project

Pressline: a self-hostable bridge from an image-generating app (an Engine) to print-on-demand products. Printful fulfils, Stripe Checkout pays, one Operator per instance. Read `CONTEXT.md` before naming anything and `docs/adr/` before working around a constraint. The spec is `docs/SPEC.md`; tickets are GitHub sub-issues of #1.

### Load-bearing constraints (each has an ADR)

- Single-operator, never multi-tenant. No `tenantId` anywhere (ADR-0001; lint-enforced).
- The bridge never renders or decodes pixels and never stores image bytes; the Engine hosts immutable Printfile and Preview URLs (ADR-0002, 0003; lint-enforced import ban in `apps/pressline`).
- A validated Printfile exists before any Stripe session is created (ADR-0004).
- SQLite dialect only (D1 / libSQL / file); every write is a single statement or a `batch`; `withTransaction` is banned (ADR-0008; lint-enforced).
- Effect throughout: `@effect/platform` HTTP mounted inside one SvelteKit app per platform (ADR-0011, 0012).
- Configuration is a typed file plus platform secrets; the Operator View is read-only (ADR-0014).
- Webhooks are hints: verify, record the Inbound Event, re-fetch, then transition (ADR-0007, 0009).

### Commands

- `pnpm install` wires git hooks (`.githooks/`: lint-staged on commit, conventional subject line).
- `pnpm verify` runs format, lint, typecheck, ADR check, tests, build; CI runs the same steps.
- `pnpm adr:check` guards ADR numbering and frontmatter; new ADRs take the next number.

### Test seams (see `docs/SPEC.md` → Testing Decisions)

HTTP surface of the bridge with in-memory layers; adapter contract tests on recorded fixtures; render helper by PNG headers; DesignSource conformance suite. Do not add module-level tests of the ledger.
