---
title: Contributing
description: The patterns, the test seams, and the licensing rules.
---

Pressline is a small codebase with a few strong opinions. These pages cover the
ones that are not obvious from reading the source, so you can work with the
grain rather than against it.

- **[Effect primer](/contributing/effect/)** — the parts of Effect this codebase
  actually uses, and why services, layers and typed errors are worth the
  unfamiliarity. Enough to be productive, not a tour of the library.
- **[Test seams and fixtures](/contributing/testing/)** — where the tests cut,
  and why. The HTTP surface is tested with in-memory layers, provider adapters
  against recorded fixtures, and Engines through the conformance suite.
- **[Licenses](/contributing/licenses/)** — the project's own license, and the
  rules for anything you add: bundled fonts, sample assets and dependencies.

Two things worth knowing before you open a pull request. `pnpm verify` runs
exactly what CI runs, so a green local run means a green build. And the decisions
that constrain the design live in `docs/adr/` in the repository: read the
relevant one before working around a constraint, because most of them are
load-bearing and lint-enforced.
