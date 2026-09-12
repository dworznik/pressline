---
status: accepted
---

# oxlint replaces ESLint, and TypeScript 7 reaches only the code whose toolchain accepts it

Moving to TypeScript 7 broke ESLint here: `typescript-eslint` declares `typescript >=4.8.4 <6.1.0` and refuses to load, and ESLint without that parser can only read the handful of `.js`/`.mjs` files in this repo. We swapped to **oxlint**, which brings its own parser and is indifferent to the TypeScript version, and we let each workspace hold the TypeScript its own toolchain accepts rather than forcing one version on all of them.

**TypeScript per workspace.** `packages/*` and the repo root run TypeScript 7 outright. The two SvelteKit apps hold TypeScript 6 plus 7 aliased as `@typescript/native`, and run `svelte-check --tsgo`, which is the dual install `svelte-check` itself prescribes; they are type-checked by 7. `apps/docs` stays on TypeScript 6 alone: `astro check` needs a programmatic API the native compiler does not ship yet (withastro/roadmap#1321), so the docs site is the one place still checked by 6. Collapse the split when the upstream tools catch up, not before.

**The ADR bans moved out of lint.** oxlint has no `no-restricted-syntax` (which carried ADR-0008) and no Svelte parser at all, so a lint rule could no longer see `.svelte`. `scripts/check-bans.mjs` now enforces all three bans across every source file, and `pnpm lint` is `oxlint && node scripts/check-bans.mjs`.

## Considered options

- Stay on TypeScript 6 and keep ESLint (rejected: the point was to move to 7, and the Svelte and Astro toolchains pin 6 regardless, so the split exists either way).
- One TypeScript version for the whole workspace (rejected: 7 breaks `astro check`, and 6 would mean the packages never see the compiler they ship against).
- Keep ESLint alongside oxlint just for `.svelte` (rejected: `eslint-plugin-svelte` parses TypeScript through `typescript-eslint`, so it fails for the same reason; a second linter for one file type is also a second set of rules to keep honest).

## Consequences

- **`.svelte` files are not linted.** `svelte-check` (each app's `check` script) is what guards them now, and it catches type errors in both `.ts` and `.svelte`, but not the lint rules `eslint-plugin-svelte` carried, e.g. `svelte/no-navigation-without-resolve`. Reviews carry that weight until oxlint gains a Svelte parser.
- oxlint's `correctness` category is stricter than the old config in places; `pedantic` and `suspicious` are off deliberately, as mostly style.
- `oxlint-tsgolint` (the `lint:type-aware` pass) is version-locked to the TypeScript major, so a TypeScript bump needs a matching bump here or that pass silently goes dark. It is not part of `pnpm verify`, and today it reports nine pre-existing findings (mostly `String(formData.get(x))`, which stringifies a `File` as `[object File]`); tracked separately rather than folded into the toolchain change.
- Prettier writes no semicolons (`semi: false`), matching the sibling repo this toolchain came from; the reformat commit is listed in `.git-blame-ignore-revs`.
