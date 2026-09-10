# packages/

Published npm packages (ADR-0013): `contract` (`@pressline/contract`, ticket #3), `render` (`@pressline/render`, #20), `cli` (`@pressline/cli`, #16). Each package owns its `check`, `test` and `build` scripts and a `vitest.config.ts` so the root runner picks it up.
