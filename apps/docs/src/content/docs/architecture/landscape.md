---
title: Landscape
description: Who and what stands around Pressline.
---

**Encodes:** [ADR-0001](https://github.com/dworznik/pressline/blob/main/docs/adr/0001-single-operator.md), [ADR-0002](https://github.com/dworznik/pressline/blob/main/docs/adr/0002-engine-renders-pressline-validates.md), [ADR-0003](https://github.com/dworznik/pressline/blob/main/docs/adr/0003-engine-hosts-printfiles-pull-protocol.md), [ADR-0013](https://github.com/dworznik/pressline/blob/main/docs/adr/0013-monorepo-core-is-not-a-library.md).

<iframe src="/architecture/#/embed/landscape/?padding=20" title="Landscape" loading="lazy" style="width: 100%; height: 560px; border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; background: var(--sl-color-bg)"></iframe>

[Open full screen](/architecture/#/view/landscape/)

Who and what stands around Pressline. Three people: the Customer, who makes a Design in an Engine and buys it printed; the Operator, who runs the one instance and owns the Printful and Stripe accounts; the Engine developer, who builds the Engine, often the same person as the Operator. Pressline talks to roles, not vendors: a Fulfilment Provider, a PSP and a Mailer, each with one shipped implementation. The Engine renders and hosts every Printfile and Preview; Pressline never touches pixels.
