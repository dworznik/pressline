---
title: Demo Mode
description: The whole flow with no money and no goods moving.
---

`demo: true` in the config: Stripe must hold a test-mode key (boot refuses a live one), the design page tells Customers to pay with `4242 4242 4242 4242`, Printful drafts are created for real and then cancelled where the confirmation would be (the Order reaches `submitted` and immediately `cancelled`, with a Transition note saying why), and the Operator View is readable without logging in so visitors can watch. Every action still needs the operator token. pressline.store runs this way.
