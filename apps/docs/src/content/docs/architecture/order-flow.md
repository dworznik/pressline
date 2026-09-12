---
title: Order flow
description: One Order from Quote to shipped, as a sequence.
---

**Encodes:** [ADR-0004](https://github.com/dworznik/pressline/blob/main/docs/adr/0004-printfile-before-payment.md), [ADR-0005](https://github.com/dworznik/pressline/blob/main/docs/adr/0005-ensure-printfile-sync-or-202.md), [ADR-0007](https://github.com/dworznik/pressline/blob/main/docs/adr/0007-printful-api-v2.md), [ADR-0009](https://github.com/dworznik/pressline/blob/main/docs/adr/0009-order-state-machine.md), [ADR-0010](https://github.com/dworznik/pressline/blob/main/docs/adr/0010-fixed-retail-price-quote-on-storefront.md).

<iframe src="/architecture/#/embed/order-flow/?padding=20&dynamic=sequence" title="Order, happy path" loading="lazy" style="width: 100%; height: 820px; border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; background: var(--sl-color-bg)"></iframe>

[Open full screen](/architecture/#/view/order-flow/)

One Order from Quote to shipped, as a sequence. The Storefront fetches the Design from the Engine; the HttpApi obtains and validates the Printfile before it creates the Checkout session; the Customer pays on the PSP's hosted page. Every webhook is treated as a hint: verify, record the Inbound Event, re-fetch the object from the provider, then transition. Each step's note names the Order state it reaches; the full transitions table is on the [Operator guide's orders page](/operator/orders/#transitions).
