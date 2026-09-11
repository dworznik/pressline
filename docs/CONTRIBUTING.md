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

_TODO: expand with retry/Schedule, HttpApi handlers, and the `batch`-only Db rule once the first provider ticket lands._

## Test seams

See `docs/SPEC.md` → Testing Decisions. Bridge behaviour is tested through its HTTP surface with in-memory services (`apps/pressline/tests/harness.ts`); do not add module-level tests of the ledger.
