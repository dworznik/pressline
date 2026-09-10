# Stripe: Operator settings Pressline cannot make for you

Pressline creates Checkout Sessions with the API; a few things live only in the Stripe Dashboard.

- **Terms of Service URL** — Pressline asks Stripe to collect consent to the Withdrawal Notice (`consent_collection.terms_of_service: required`). Stripe refuses such sessions unless a Terms of Service URL is set under _Settings → Public details_. Set it, or checkout answers 502.
- **Receipts** — Pressline sends its own confirmation email. Turn off _Settings → Emails → Successful payments_ so Customers do not get two.
- **Webhook endpoint** — `POST https://<your instance>/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`; put its signing secret in `STRIPE_WEBHOOK_SECRET`. `pressline webhooks register` (ticket #16) does this for you.
- **Automatic tax** — enable Stripe Tax and set your origin address; Pressline marks prices and shipping as tax-exclusive.
- **Behind a proxy or custom domain** — set `checkout.publicUrl` in `pressline.config.ts`; Pressline does not trust forwarded headers when building return URLs.
