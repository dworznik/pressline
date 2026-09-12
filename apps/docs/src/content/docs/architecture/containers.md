---
title: Containers
description: Inside the one SvelteKit deployable, and what stands beside it.
---

**Encodes:** [ADR-0012](https://github.com/dworznik/pressline/blob/main/docs/adr/0012-sveltekit-hosts-effect-api.md), [ADR-0008](https://github.com/dworznik/pressline/blob/main/docs/adr/0008-sqlite-dialect-d1-and-libsql.md), [ADR-0004](https://github.com/dworznik/pressline/blob/main/docs/adr/0004-printfile-before-payment.md), [ADR-0014](https://github.com/dworznik/pressline/blob/main/docs/adr/0014-config-in-repo-operator-view-read-only.md), [ADR-0013](https://github.com/dworznik/pressline/blob/main/docs/adr/0013-monorepo-core-is-not-a-library.md).

<iframe src="/architecture/#/embed/containers/?padding=20" title="Containers" loading="lazy" style="width: 100%; height: 720px; border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; background: var(--sl-color-bg)"></iframe>

[Open full screen](/architecture/#/view/containers/)

Inside the one SvelteKit deployable: the Storefront and the Operator View are routes; the Effect HttpApi owns `/api/*`; the webhook receivers own `/webhooks/*`; Reconciliation runs from the platform's scheduler or the CLI. The Ledger sits beside the app because it is a platform binding (D1, libSQL or a file). The CLI is a process the Operator runs against the operator API. The Engine boundary holds any Engine app and its FileStore, from which the Fulfilment Provider fetches the Printfile URL, possibly months later. The published packages are not boxes: they are the labels on the edges an Engine developer implements.
