---
title: Architecture
description: Pressline drawn as C4 views, rendered from a model kept in the repo.
---

Pressline drawn as C4 views, rendered from a model kept in the repo (`docs/architecture/*.c4`) and reviewed like code. Every element uses the glossary's names; every box that encodes an architecture decision links to its ADR. Open any view full-screen to click through elements, read descriptions and follow the ADR links.

<iframe src="/architecture/#/embed/landscape/?padding=20" title="Landscape" loading="lazy" style="width: 100%; height: 560px; border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; background: var(--sl-color-bg)"></iframe>

[Open full screen](/architecture/#/view/landscape/)

The other views:

- [Containers](/architecture/containers/): inside the one SvelteKit deployable, the Ledger and the CLI beside it, the Engine boundary.
- [Effect service layer](/architecture/service-layer/): the five services and their adapters, with the entry points as callers.
- [Order flow](/architecture/order-flow/): one Order from Quote to shipped, as a sequence.
- [Reconciliation](/architecture/reconciliation/): one pass of the truth check that catches what webhooks missed.

The model is validated and tested on every change; see [editing the model](/contributing/testing/#architecture-model).
