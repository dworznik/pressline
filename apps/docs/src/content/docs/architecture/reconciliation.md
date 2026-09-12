---
title: Reconciliation
description: One pass of the truth check that catches what webhooks missed.
---

**Encodes:** [ADR-0007](https://github.com/dworznik/pressline/blob/main/docs/adr/0007-printful-api-v2.md), [ADR-0009](https://github.com/dworznik/pressline/blob/main/docs/adr/0009-order-state-machine.md).

<iframe src="/architecture/#/embed/reconciliation/?padding=20&dynamic=sequence" title="Reconciliation, one pass" loading="lazy" style="width: 100%; height: 640px; border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; background: var(--sl-color-bg)"></iframe>

[Open full screen](/architecture/#/view/reconciliation/)

The other half of "webhooks are hints": what happens when one never arrives. On schedule, Reconciliation reads every open Order, re-fetches it from the PSP and the Fulfilment Provider, writes a Transition for anything the webhooks missed with Cause `reconciliation`, and emails Alarms to the Operator only when there are any.
