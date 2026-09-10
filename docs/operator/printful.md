# Printful: Operator settings and secrets

- **API token** — a Printful private token (`PRINTFUL_TOKEN`). Pressline uses API v2 (Open Beta, ADR-0007).
- **Webhooks** — `pressline webhooks register` (ticket #16) configures `POST https://<your instance>/webhooks/printful` for order and shipment events. Printful answers with a `secret_key` (hex) and a `public_key`; put them in `PRINTFUL_WEBHOOK_SECRET` and `PRINTFUL_WEBHOOK_PUBLIC_KEY`. Deliveries are verified with HMAC-SHA256 over the raw body; deliveries for another configuration, or older than 24 hours, are rejected.
- **Only one webhook configuration per token** — registering from Pressline replaces any other configuration on that token.
- **Costs** — the Provider Cost Estimate is what Printful quoted at Quote time; the confirmed order's invoice may differ and is logged, never re-charged (ADR-0010).
