---
title: Go live
description: The checklist between a deployed instance and the first paid order.
---

1. `pressline doctor` shows every secret present, every Engine enabled, Printful and Stripe reachable, both webhooks registered.
2. `pressline catalog check` resolves every Offer; `pressline printfile check <url> --offer … --variant …` on a Printfile your Engine produced passes.
3. Rehearse with `demo: true` and a test Stripe key: place an order, watch it reach `submitted` then `canceled` on the Operator View, receive the emails.
4. Read the Withdrawal Notice and your terms with counsel ([Legal wording](/operator/legal/)).
5. `demo: false`, `sk_live_…`, `email.operator` set so Alarms reach you, redeploy.
6. Place one real order to yourself.
