# Demo Mode

`demo: true` in `pressline.config.ts` runs the whole flow with no money and no goods moving. Everything else is real: Engines render, Printfiles are validated, Printful checks the address and prices the draft, Stripe collects a test payment, emails go out.

- **Stripe** must hold a test-mode key; the instance refuses to boot with `sk_live_…` while `demo` is on. The design page tells Customers to pay with `4242 4242 4242 4242`.
- **Printful** drafts are created for real and then cancelled where the confirmation would be. The Order reaches `submitted` and immediately `cancelled`, with a Transition note saying why.
- **Operator View** is readable without logging in, so visitors can watch an Order move; every action (CLI, `POST /api/operator/*`) still needs the operator token.

The demo instance runs this way.
