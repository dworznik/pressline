# LikeC4 facts the architecture map hangs on

Research for [#62](https://github.com/dworznik/pressline/issues/62), feeding the
wayfinder map in [#61](https://github.com/dworznik/pressline/issues/61).

Checked against **`likec4` 1.59.3** (npm `latest`, published 2026-09-02; GitHub
release `v1.59.3` tagged the same day) on **2026-09-12**. Source links point at the
`v1.59.3` tag so they stay stable. Repo facts used below: root `package.json` sets
`engines.node >=24` and `packageManager pnpm@11.7.0`; `.node-version` is `24`.

Sources are primary only: likec4.dev docs, the `likec4/likec4` repo at `v1.59.3`,
the `likec4/actions` repo, the npm registry, Playwright and Vite docs.

## 1. Base path

**Answer:** Yes. `likec4 build --base /pressline/architecture/` (alias `--base-url`)
sets Vite's `base`; the SPA router reads its `basepath` from `import.meta.env.BASE_URL`,
so both asset URLs and in-app navigation are base-aware. `./` gives a relocatable build.

Evidence:

- CLI docs, build section: `--base, --base-url`: "Base URL from which the app is being
  served, e.g., "/", "/pages/", or "./" for a relocatable app".
  https://likec4.dev/tooling/cli/
- Option definition: `base: { alias: ['base-url'], string: true, desc: 'base url the app
is being served from, e.g. "/" or "/pages/"' }`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/options.ts
- `build` handler passes `base: args.base` straight to `viteBuild(...)`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/build/index.ts
- Vite app config: `base` defaults to `'/'`, gets `withTrailingSlash`, and gets a leading
  slash unless it has a protocol or is `./`; the result is assigned to Vite's `base`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/vite/config-app.ts
- The `likec4:app-config` virtual module: `export let basepath = useHashHistory ? '/' : BASE`
  where `BASE` is `import.meta.env.BASE_URL` with a trailing slash.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/vite-plugin/src/virtuals/app-config.ts
- SPA router: `basepath` from `likec4:app-config`;
  `history: useHashHistory ? createHashHistory() : createBrowserHistory()`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4-spa/src/router.tsx
- The GitHub Pages guide builds with
  `--base "${{ steps.pages.outputs.base_path || '/' }}"` and notes the base is required
  when the repo has no custom domain. https://likec4.dev/guides/deploy-github-pages/
- Changelog v1.13.0: "Build with `--base './'`: Allows to build a relocatable website".
  https://github.com/likec4/likec4/releases/tag/v1.13.0

Implications for Pressline:

- Two builds (or one relocatable `--base ./` build) cover `/pressline/architecture/` on
  GitHub Pages and `/architecture/` on pressline.dev, mirroring `DOCS_BASE`.
- `--use-hash-history` is the escape hatch for deep links: the router then uses
  `/#/view/...` and `basepath` is forced to `/`. The build emits `404.html` as a copy of
  `index.html`, which is what makes browser-history deep links work on GitHub Pages at the
  site root; under `apps/docs/public/architecture/` Astro's own 404 wins, so hash history
  is the safer default for deep links there.
- `--output-single-file` implies hash history (handler:
  `useHashHistory: params.outputSingleFile || params.useHashHistory`).

## 2. Validation

**Answer:** Yes. `likec4 validate [path]` ("Validate syntax, semantics and layout drifts")
writes no site, sets `process.exitCode = 1` on any parse/semantic **error** or manual-layout
drift, and offers `--no-layout`, `--json`, `--file`. Warnings do not fail it. `likec4 build`
does **not** fail on an invalid model, so `validate` is the CI gate.

Evidence:

- CLI docs: "This command checks for: Syntax errors, Layout drift (outdated manual layout).
  If any errors are found, the command exits with a non-zero return code."
  https://likec4.dev/tooling/cli/
- Source: command `"validate [path]"`, describe "Validate syntax, semantics and layout
  drifts"; options `project`, `file`/`-f` (array), `layout` (boolean, default on),
  `json`; errors via `languageServices.getErrors()`, drift via
  `languageServices.diagrams(...)` checking `view.drifts`; `process.exitCode = valid ? 0 : 1`;
  no files written.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/validate/index.ts
- `valid: filteredErrors.length === 0` (result.ts).
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/validate/result.ts
- `getErrors()` filters document diagnostics with `isErrorDiagnostic`, i.e. errors only.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/language-server/src/LikeC4LanguageServices.ts
- Changelog v1.53.0: "Improve `likec4 validate` CLI command: Fix exit code, Add `--json`
  flag ..., Add `--file` flag ..., Add `--no-layout` flag to skip layout drift checks".
  v1.59.3: "`likec4 validate --file` now counts every file matched by the filter".
  https://github.com/likec4/likec4/releases
- `build` does no error check: the handler calls `fromWorkspace(args.path, { graphviz,
watch: false })` and goes straight to `viteBuild`; `LikeC4Options.throwIfInvalid`
  defaults to `false` ("By default, if LikeC4 model is invalid, errors are printed to the
  console"). The only hard failure in `viteBuild` is "no views found".
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/build/index.ts
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/LikeC4.ts
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/vite/vite-build.ts
- The "Enforce and validate your model" guide covers a different thing: Vitest tests
  against the model API for house rules (e.g. every `app` has a `technology`).
  https://likec4.dev/guides/validate-your-model/

Implication: add `likec4 validate docs/architecture` to `pnpm verify`. Layout-drift checks
only bite once manual layouts exist; `--no-layout` is available if they get noisy.

## 3. Export

**Answer:** `likec4 export png|jpg` starts a local Vite server and drives **headless
Chromium through Playwright** (pinned dependency `playwright@1.60.0`); the Chromium binary
is not bundled and must be installed (`npx playwright install --with-deps chromium`) or
supplied by the `likec4/actions@v1` Docker image. There is **no `svg` export**; the other
formats are `json`, `drawio`, `markdown` (no browser needed). In GitHub Actions the cost is
one browser-install step per run plus per-view screenshots with a 15 s Playwright timeout
and 3 attempts; exact minutes are not stated by any primary source.

Evidence:

- CLI docs: "This command starts local web server and uses Playwright to take screenshots.
  If you plan to use it in CI, refer to the Playwright documentation for details or
  consider LikeC4 GitHub Actions"; "Exporting to PNG or JPEG requires Playwright. You will
  be prompted with a command to install if it's not found." Options `--theme`
  (`light`/`dark`), `--timeout` (seconds, default 15), `--max-attempts` (default 3),
  `--server-url` ("use this url instead of starting new likec4 server").
  https://likec4.dev/tooling/cli/
- Registered export subcommands: `png`, `jpg`, `json`, `drawio`, `markdown`. No `svg`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/export/index.ts
- PNG handler: without `--server-url` it runs
  `viteDev({ languageServices, buildWebcomponent: false, openBrowser: false, hmr: false })`,
  then `chromium.launch({ chromiumSandbox, headless: true })`; failed views are retried up
  to `maxAttempts` and the run throws unless `--ignore` and at least one view succeeded.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/export/png/handler.ts
- npm: `dependencies.playwright: "1.60.0"` (the `playwright` package, so the installer
  CLI ships with likec4, but browsers still need `playwright install`).
  `npm view likec4 dependencies`, 2026-09-12.
- Changelog (1.5x line): "Fixed `export png` / `export jpg` failing in the Docker image
  with `browserType.launch: Executable doesn't exist`. The bundled Playwright and the
  installed Chromium browsers are now kept in sync." (confirms the browser is a separate
  install). https://github.com/likec4/likec4/releases
- `likec4/actions@v1` runs `docker://ghcr.io/likec4/actions:v1.89.0` with inputs `action`
  (`build`/`export`/`codegen`), `export: png`, `path`, `output`, `base`, `likec4-version`,
  `use-dot-bin`, `use-hash-history`, `webcomponent-prefix`.
  https://github.com/likec4/actions/blob/main/action.yml
  https://likec4.dev/tooling/github/
- Playwright CI docs: install with `npx playwright install --with-deps`; "Caching browser
  binaries is not recommended, since the amount of time it takes to restore the cache is
  comparable to the time it takes to download the binaries."
  https://playwright.dev/docs/ci

Not settled from primary sources: wall-clock cost of the browser install and of the
screenshot loop on `ubuntu-latest`. Neither likec4 nor Playwright publishes numbers.
The map only needs the built SPA, so PNG export is optional; if wanted later, use the
Docker-based action or a dedicated job, not `pnpm verify`.

## 4. Dynamic views

**Answer:** Yes. `dynamic view` is a first-class DSL construct rendered by the built SPA
(diagram or sequence variant). Steps take titles and Markdown `notes`; `parallel`/`par`,
`opt`, `loop`, `break`, `alt`, `try` blocks exist but are marked experimental; nested
`parallel` blocks are prohibited; the sequence variant only connects leaf elements. No
documented cap on step count or notes.

Evidence:

- Dynamic views doc: a dynamic view depicts "a particular use-case or scenario, with
  specific elements and interactions, defined only in the view (without polluting the
  model)"; steps `actor -> component 'description'`, chained `A -> B -> C`; "Notes can be
  used to add additional information to the step. It supports Markdown"; blocks
  `parallel`/`par`, `opt`, `loop`, `break`, `alt` (`when`/`else`), `try`/`catch`/`finally`
  are "experimental; syntax may change"; "Nested parallel blocks are prohibited"; sequence
  variant "requiring leaf-element connections only"; `navigateTo` links steps to other
  dynamic views. https://likec4.dev/dsl/views/dynamic/
- SPA/webcomponent support: the generated web component has `dynamic-variant`
  ("How dynamic view should be rendered. Possible values: `diagram` or `sequence`").
  https://likec4.dev/tooling/code-generation/webcomponent/
- The embed route reads a `dynamic` search param and passes `dynamicViewVariant`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4-spa/src/pages/EmbedPage.tsx

## 5. Deployment views

**Answer:** Yes, `deployment { ... }` model and `deployment view` exist in the DSL, but the
docs flag gaps ("`with` expressions, Shared styles and predicates, Relationships browser,
Element and Relationship Details popups" are "not supported yet or do not work as
expected"). Recorded only; out of scope for this map.

Evidence:

- https://likec4.dev/dsl/deployment/model/ and https://likec4.dev/dsl/deployment/views/
  (quote above; `includeAncestors` attribute).
- Changelog v1.57.0: "Add `includeAncestors` property to deployment views".
  https://github.com/likec4/likec4/releases/tag/v1.57.0

## 6. Embedding

**Answer:** Yes. The built SPA has a dedicated iframe route, `/embed/<viewId>/?padding=20`
(plus `&theme=light|dark`), and its own Share dialog emits exactly that `<iframe>` snippet
("Embedded view is an iframe with a static diagram"). Every view has a full-page URL
`/view/<viewId>/` for the "open full screen" link (both honour `--base` and hash history).
There is **no `postMessage` API**; theming hooks are the `theme` query param, the build-time
`--theme light|dark` default, and the `color-scheme` attribute on the web component.

Evidence:

- Routes in the SPA: `/_single/embed/$viewId` renders `EmbedPage`;
  `/_single/view/$viewId/` renders the view page; also `/_single/export/$viewId` and
  `/view/$viewId.{mmd,dot,d2,puml}`.
  https://github.com/likec4/likec4/tree/v1.59.3/packages/likec4-spa/src/routes/_single
- Share modal, Embed panel: URL is `'/embed/$viewId/'` with `padding=20` and `theme` when
  not `auto`, wrapped as `useHashHistory ? '#${location}' : location` and resolved with
  `new URL(location, window.location.href)`; iframe width/height derive from
  `diagram.bounds` plus padding.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4-spa/src/components/view-page/share-modal/EmbedPanel.tsx
- `EmbedPage` renders `StaticLikeC4Diagram` with `background='transparent'`, `fitView`,
  relationship details/browser enabled, reads `padding` and `dynamic` search params; no
  `window.postMessage` or message listener.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4-spa/src/pages/EmbedPage.tsx
- CLI docs: "When you deployed the website, you can use 'Share' button and get a link to a
  specific diagram." https://likec4.dev/tooling/cli/
- Changelog v1.27.3: "build embed url with respect to the current history mode".
  https://github.com/likec4/likec4/releases/tag/v1.27.3
- Build-time theme: `--theme` ("default color scheme for the built website (default: auto,
  follows system preference)").
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/src/cli/options.ts
- Alternative to an iframe: `likec4 build` "always generates javascript with web
  components" (`<likec4-view view-id="..." browser dynamic-variant color-scheme>`), which
  could be loaded by the Astro page directly.
  https://likec4.dev/tooling/code-generation/webcomponent/

Not settled from primary sources: whether `EmbedPage` sends any resize signal (none seen in
the source, so the iframe height must be set by the host page); and cross-origin
behaviour, which is moot here because the SPA lives on the same origin under
`/architecture/`.

## 7. Toolchain

**Answer:** `likec4@1.59.3` depends on **Vite `^8.2.2`** (plus `@vitejs/plugin-react ^6.1.1`,
`esbuild 0.28.1`) and declares **`engines.node >=22.22.3`**; peer deps `react`/`react-dom`
`^19.2.x`. It runs its own Vite build in-process, so it never touches Astro 7's Vite and the
majors need not match. The repo's Node 24 / pnpm 11.7.0 clear the floor comfortably.

Evidence:

- `npm view likec4 version engines dependencies peerDependencies` on 2026-09-12:
  `version 1.59.3`, `engines.node ">=22.22.3"`, `vite "^8.2.2"`,
  `@vitejs/plugin-react "^6.1.1"`, `esbuild "0.28.1"`, `playwright "1.60.0"`,
  `react "^19.2.x"`, `react-dom "^19.2.x"` (the `@tanstack/ai-*` peers are optional).
- Repo `pnpm-workspace.yaml` catalog `vite: ^8.2.2`, `react: 19.2.8`.
  https://github.com/likec4/likec4/blob/v1.59.3/pnpm-workspace.yaml
- `packages/likec4/package.json` at the tag: `engines.node >=22.22.3`.
  https://github.com/likec4/likec4/blob/v1.59.3/packages/likec4/package.json
- Vite's own floor: "Vite requires Node.js version 20.19+, 22.12+." https://vite.dev/guide/
- The README's "requires Node.js version 20+" is stale relative to `engines`.
  https://github.com/likec4/likec4/blob/main/packages/likec4/README.md
- Isolation: `build` calls `viteBuild` from `packages/likec4/src/vite/vite-build.ts` with
  its own config (`config-app.ts`), not the host project's.
- Pressline: `package.json` `engines.node >=24`, `packageManager pnpm@11.7.0`,
  `.node-version` `24`; CI uses `node-version-file: .node-version`.

Caveat: pnpm will install two Vite majors side by side (Astro 7 pins its own); that is
routine for pnpm's isolated `node_modules` and the two never share a process. Peer-dep
warnings for `react`/`react-dom` are expected in a workspace that has no React; the CLI
path does not need them installed by the host.

## 8. Model layout

**Answer:** Yes. All `.c4`/`.likec4` files under the project folder (recursively) are
merged into a single model, so `docs/architecture/` can hold many files and a dedicated
`specs.c4` for element kinds, tags and colours. Multiple `specification`, `model` and
`views` blocks across files are allowed; elements defined elsewhere are enriched with
`extend` by fully qualified name. A `likec4.config.json` (with a `name`) marks the folder
as a project and is what `validate`/`build` are pointed at.

Evidence:

- "Source files must have `.likec4` or `.c4` extensions. All sources are merged into a
  single model"; the example tree has `backend/service1/{model,views}.c4`,
  `externals/amazon.c4`, `landscape.c4` and `specs.c4` at the top level.
  https://likec4.dev/dsl/intro/
- "You can extend the model by creating new files and folders. When LikeC4 source files
  are parsed, they are merged into a single architecture model."; "You are free to
  organize the workspace as you want."; "An extended element must be referenced by its
  fully qualified name." https://likec4.dev/dsl/extend/
- Multiple blocks of the same type are allowed (`// Views group 1 views {} // Views group
2 views {}`). https://likec4.dev/dsl/intro/
- Project config: "To define a project, create a `likec4.config.json` file in the folder.
  All files in the folder (and subfolders) will be part of this project."; the file "must
  have the name of the project"; `exclude` defaults to `["**/node_modules/**"]`; `include`
  can pull files from outside the folder; `styles.theme` / `styles.defaults` override
  colours and defaults. Alternative names: `.likec4rc`, `likec4.config.{js,mjs,ts,mts}`.
  https://likec4.dev/dsl/config/

## Version and date

- `likec4` 1.59.3 (npm `latest`, `time.modified` 2026-09-02T14:54:52Z; GitHub release
  v1.59.3 published 2026-09-02T14:59:17Z).
- Checked 2026-09-12.
