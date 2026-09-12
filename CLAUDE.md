# Pressline

## Agent skills

### Issue tracker

Issues and specs are GitHub issues, driven with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project

Pressline: a self-hostable bridge from an image-generating app (an Engine) to print-on-demand products. Printful fulfills, Stripe Checkout pays, one Operator per instance. Read `CONTEXT.md` before naming anything and `docs/adr/` before working around a constraint. The spec is `docs/SPEC.md`; tickets are GitHub sub-issues of #1.

### Load-bearing constraints (each has an ADR)

- Single-operator, never multi-tenant. No `tenantId` anywhere (ADR-0001; enforced by `scripts/check-bans.mjs`).
- The bridge never renders or decodes pixels and never stores image bytes; the Engine hosts immutable Printfile and Preview URLs (ADR-0002, 0003; import ban in `apps/pressline` enforced by `scripts/check-bans.mjs`).
- A validated Printfile exists before any Stripe session is created (ADR-0004).
- SQLite dialect only (D1 / libSQL / file); every write is a single statement or a `batch`; `withTransaction` is banned (ADR-0008; enforced by `scripts/check-bans.mjs`).
- Effect throughout: `@effect/platform` HTTP mounted inside one SvelteKit app per platform (ADR-0011, 0012).
- Configuration is a typed file plus platform secrets; the Operator View is read-only (ADR-0014).
- Webhooks are hints: verify, record the Inbound Event, re-fetch, then transition (ADR-0007, 0009).

### Commands

- `pnpm install` wires git hooks (`.githooks/`: lint-staged on commit, conventional subject line).
- `pnpm verify` runs format, lint, typecheck, ADR check, tests, build; CI runs the same steps.
- `pnpm adr:check` guards ADR numbering and frontmatter; new ADRs take the next number.

### Tooling (ADR-0017)

- **oxlint, not ESLint**: `typescript-eslint` refuses to load against TypeScript 7. `pnpm lint` is `oxlint && node scripts/check-bans.mjs`; that script carries the three ADR bans because oxlint has no `no-restricted-syntax` and no Svelte parser. Do not reintroduce ESLint.
- **`.svelte` files are not linted**, only type-checked by `svelte-check`.
- **TypeScript is not uniform**: root and `packages/*` on 7; the SvelteKit apps on 6 plus 7 aliased as `@typescript/native` with `svelte-check --tsgo`; `apps/docs` on 6 alone because `astro check` needs an API the native compiler lacks. Do not unify it.
- **Prettier writes no semicolons** (`semi: false`).

### Branches

- `main` is the only long-lived branch. Everything else is a short-lived branch merged by PR.
- Name: `<type>/<issue>-<slug>`, e.g. `feat/5-storefront-design-page`, `chore/2-monorepo-skeleton`. `type` is one of the commit-msg types (`feat fix docs test refactor chore ci build perf adr`); `issue` is the GitHub ticket number; slug is short kebab-case. No ticket → drop the number (`chore/bump-effect`). Never `feature/`.
- The `pre-push` hook warns (never blocks) on a non-conforming name; `dependabot/*` is exempt.

### Provider behavior

`docs/audit/order-lifecycle.md` is the audit of the Stripe and Printful lifecycles
against their own docs: what each provider state and event means, what we do with
it, and what proves it. Read it before changing a webhook handler, the submit flow
or Reconciliation; it also records what is deliberately unhandled and what neither
provider documents. Gaps are sub-issues of #85.

### Test seams (see `docs/SPEC.md` → Testing Decisions)

HTTP surface of the bridge with in-memory layers; adapter contract tests on recorded fixtures; render helper by PNG headers; DesignSource conformance suite. Do not add module-level tests of the ledger.
