---
title: Try the demo
description: A live instance in Demo Mode, where you can design something, order it, and watch the order move.
---

There is a running instance you can use. It is in **Demo Mode**: every step is
real except the last one, so nothing is produced, shipped or charged.

It is two separate apps, which is the whole idea of Pressline:

- **[The designer](https://pressline-store-demo.vercel.app/)** — a sample
  **Engine**. It makes the image. In your own setup this is your app, and
  Pressline never sees how it works.
- **[The shop](https://pressline-demo.vercel.app/)** — Pressline itself. It
  turns a design into a product you can buy.

## Walk through it

1. Open **[the designer](https://pressline-store-demo.vercel.app/)**, type some
   text, pick a shape and colors, and press **Finalize**. Behind that button the
   Engine stores your design, renders a preview, asks the shop what it sells, and
   pre-renders a print file for every product and size that fits the design's
   shape.
2. Press **Order a print**. You land on the shop, on a page that belongs to your
   design: the product, the sizes and colors, a shipping destination, and a price
   that includes shipping and tax.
3. Pay with Stripe's test card **4242 4242 4242 4242**, any future expiry, any
   three digits. No real card is accepted and no money moves.
4. You get a thank-you page, a tracking link and an email. Follow the link to
   watch the order's state.

## What is real and what is not

Real: the design, the print file and its validation, the product data and prices
from Printful, the shipping quote, the Stripe checkout in test mode, the print
order placed at Printful, and the emails.

Not real: the last step. Printful creates the order for real, checks the address
and prices it, and then Pressline **cancels it** exactly where it would normally
confirm. The order reaches `submitted` and immediately `canceled`, and the
thank-you page, the status page and the email all say so. Nothing is printed and
nothing ships.

## Watch the machinery

Demo Mode also opens the **[Operator View](https://pressline-demo.vercel.app/operator)**,
which normally needs a token. It is read-only, and it is the most interesting
part to look at after you order:

- **[Orders](https://pressline-demo.vercel.app/operator/orders)** — every order,
  and inside one, its full history: each state change, what caused it (the
  storefront, a Stripe webhook, a Printful webhook, the CLI, or the nightly
  reconciliation), every webhook received, and every email sent.

That history is the point of Pressline. Webhooks are treated as hints rather
than facts: each one is recorded, then the truth is re-fetched from the provider
before the order moves, and a nightly pass repairs anything a missed webhook left
behind.

## Then

Read **[the Operator guide](/operator/)** to run your own instance, or **[the
Engine developer guide](/engine/)** to connect your own app to one.
