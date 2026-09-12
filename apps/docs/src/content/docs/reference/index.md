---
title: Reference
description: The CLI, the JSON API, and every configuration field.
---

Lookup material rather than reading material. Each page here is generated from,
or checked against, the code it documents.

- **[CLI](/reference/cli/)** — every `pressline` command. The CLI is a client of
  your instance's operator API over HTTP: it never touches your database or your
  providers directly, so it works the same against a local instance and a
  deployed one.
- **[JSON API (OpenAPI)](/reference/api/)** — the HTTP surface, generated from
  the same schemas the server validates with. Storefront endpoints are public;
  everything under the operator path needs your token.
- **[Configuration](/reference/config/)** — every field of `pressline.config.ts`,
  with types and defaults, plus the environment variables that carry secrets.

For the decisions behind the shapes here, see the architecture decision records
in the repository's `docs/adr/`.
