---
title: Demo Mode
description: The whole flow with no money and no goods moving.
---

`demo: true` in the config: Stripe must hold a test-mode key (boot refuses a live one), the design page tells Customers to pay with `4242 4242 4242 4242`, Printful drafts are created for real and then canceled where the confirmation would be (the Order reaches `submitted` and immediately `canceled`, with a Transition note saying why), the thank-you page, the order-status page and the confirmation email tell the Customer that the order was canceled straight away and nothing is produced, shipped or charged, and the Operator View is readable without logging in so visitors can watch. Every action still needs the operator token. The demo instance runs this way.
