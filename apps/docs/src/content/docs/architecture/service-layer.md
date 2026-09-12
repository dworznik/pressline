---
title: Effect service layer
description: The five services, their adapters, and who calls them.
---

**Encodes:** [ADR-0011](https://github.com/dworznik/pressline/blob/main/docs/adr/0011-effect-throughout.md), [ADR-0008](https://github.com/dworznik/pressline/blob/main/docs/adr/0008-sqlite-dialect-d1-and-libsql.md), [ADR-0014](https://github.com/dworznik/pressline/blob/main/docs/adr/0014-config-in-repo-operator-view-read-only.md).

<iframe src="/architecture/#/embed/service-layer/?padding=20" title="Effect service layer" loading="lazy" style="width: 100%; height: 720px; border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; background: var(--sl-color-bg)"></iframe>

[Open full screen](/architecture/#/view/service-layer/)

The seam a contributor meets first. Five services, one per external dependency: Db, DesignSource, FulfilmentProvider, Psp, Mailer. Each is a contract with adapters chosen at boot from the config file and platform secrets: three database drivers, the HTTP adapter to the Engine, Printful and the Demo Mode provider, Stripe Checkout, Resend. The entry points from the container view are drawn as callers so you can see which one touches which service. Test doubles exist for every service and are described, not drawn.
