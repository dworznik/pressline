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

To cut a release:

1. Bump `version` in all four `packages/*/package.json` to the same value, on `main`.
2. Draft a GitHub Release whose tag is `v<that version>` (`v0.2.0`, or `v0.2.0-rc.1`).
3. Publish the release. `.github/workflows/release.yml` takes it from there: it
   checks the tag against the four manifests, runs `pnpm verify`, and then
   `pnpm --recursive publish`.

The workflow holds no npm token. It authenticates with [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers/): GitHub mints an OIDC
token (`id-token: write`), pnpm exchanges it per package for a short-lived
registry token, and npm records a provenance attestation linking the tarball to
the commit and workflow that built it. Each package must therefore be registered
as a trusted publisher on npmjs.com — pointing at this repository and the
`release.yml` workflow — which npm only allows once a package already exists, so
the very first publish of a _new_ package has to be done by hand.

Two things not to change without knowing why:

- **`--batch` must stay off.** pnpm disables OIDC on the batch code path, and the
  publish would go out unauthenticated.
- **`workspace:^`, never `workspace:*`.** pnpm rewrites the protocol at publish
  time; `*` becomes an exact pin, which strands a dependent on a single patch of
  its dependency.

A version already on the registry is skipped rather than re-published, so a
release that fails halfway can be re-run once the cause is fixed.
