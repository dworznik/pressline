# Contributing

Read `CONTEXT.md` for vocabulary and `docs/adr/` for the decisions you must not undo. `docs/SPEC.md` is the v1 spec; work is tracked as GitHub sub-issues of #1.

## Setup

```
pnpm install     # wires git hooks
pnpm verify      # format · lint · typecheck · adr · test · build
pnpm e2e         # Playwright Storefront e2e (needs `pnpm exec playwright install chromium` once); CI runs it as its own job
```

Branches: `<type>/<issue>-<slug>` (see `CLAUDE.md`). Commits: `type(scope): summary`.

## Effect primer

Pressline is written in Effect end to end (ADR-0011). The five ideas you need:

- **`Effect<A, E, R>`** is a description of a computation that succeeds with `A`, fails with a typed `E`, and needs services `R`. Nothing runs until a runtime runs it.
- **Services** are `Context.Tag`s (`Db`, `Config`, `DesignSource`, …). Code asks for one with `yield* Db` inside `Effect.gen`.
- **Layers** build services (`layerSqliteNode(path)`, `layerMailerNone`). Production wiring lives in `src/lib/server/runtime.ts`; the test harness wires in-memory layers instead.
- **Typed errors** are `Schema.TaggedError` classes (`DbError`, `ProviderError`). Handle with `Effect.catchTag`; never throw.
- **Schema** validates every boundary: config at boot, request/response bodies, provider payloads.

The fuller primer is on the docs site: `apps/docs/src/content/docs/contributing/effect.md` (docs site → Contributing → Effect primer).

## Test seams

See `docs/SPEC.md` → Testing Decisions. Bridge behavior is tested through its HTTP surface with in-memory services (`apps/pressline/tests/harness.ts`); do not add module-level tests of the ledger.

## Releasing

The four packages under `packages/` publish to npm as `@pressline/*` and release in
lockstep at one version. Everything else in the workspace is `private: true` and
never ships.

**A release is a merged version bump.** Raise `version` in all four
`packages/*/package.json` to the same value, open the PR as usual, and merging it
to `main` publishes. Nothing else to click.

`.github/workflows/release.yml` runs on every push to `main` and starts by asking
`scripts/release-status.mjs` what is missing from the registry. Almost always the
answer is nothing and the job stops there in a few seconds. When a bump lands it
runs `pnpm verify`, publishes with `pnpm --recursive publish`, and tags the commit
`v<version>` afterwards — the tag records what shipped rather than deciding it.

The same workflow runs on the pull request, where it rehearses that publish
instead of performing it. So a bump that cannot publish fails its own PR, and one
that goes green will publish when merged. See below for what the rehearsal proves.

`release-status.mjs` also refuses a bump where the four packages disagree on the
version, which would otherwise publish some of them and leave the rest behind.

The workflow holds no npm token. It authenticates with [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers/): GitHub mints an OIDC
token (`id-token: write`), pnpm exchanges it per package for a short-lived
registry token, and npm records a provenance attestation linking the tarball to
the commit and workflow that built it. Each package must therefore be registered
as a trusted publisher on npmjs.com — pointing at this repository and the
`release.yml` workflow — which npm only allows once a package already exists, so
the very first publish of a _new_ package has to be done by hand.

Whether a package is registered lives on npmjs.com, and nothing in this
repository can read it. That matters because packages publish in dependency
order: a missing registration takes the release down part-way, with `contract`
on the registry and its dependents not.

That is what the rehearsal on the pull request is for, and why it is worth a job
rather than a note in a checklist. pnpm builds its publish options — the token
exchange included — before it honors `--dry-run`, so the rehearsal authenticates
against npm for real while publishing nothing, and fails if any package would have
fallen back to a credential the workflow does not have. A missing registration is
therefore a red pull request, not a half-finished release.

It is skipped on pull requests from forks, which are never given an OIDC token.

Two things not to change without knowing why:

- **`--batch` must stay off.** pnpm disables OIDC on the batch code path, and the
  publish would go out unauthenticated.
- **`workspace:^`, never `workspace:*`.** pnpm rewrites the protocol at publish
  time; `*` becomes an exact pin, which strands a dependent on a single patch of
  its dependency.

A version already on the registry is skipped rather than re-published, so a
release that fails halfway can be re-run once the cause is fixed.
