# Pressline v1

Status: ready-for-agent. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/0001`–`0015`. This spec does not restate the ADRs; it references them.

## Problem Statement

People building apps that generate images (template designers, AI generators, game exporters) have no cheap way to let their users hold the result in their hands. Getting from "here is an image" to "a printed shirt or poster arrives at the customer's door" means integrating a print-on-demand provider, a payment processor, tax, consumer law for personalized goods, webhooks, and a support process; existing bridges assume a storefront platform in the middle. An Engine developer wants to add a single "Order a print" button and be done.

## Solution

Pressline is a self-hostable, open-source bridge. An Operator deploys one instance to Cloudflare or Vercel with a click, configures a Catalog of Offers and one or more Engines, and sets Printful, Stripe and Resend secrets. Each Engine implements the small DesignSource protocol (return a Design's metadata and Preview; render a Printfile for a Printfile Spec Pressline supplies). Customers land on Pressline's Storefront from the Engine, choose product, variant and country, get a locked Quote, pay through Stripe Checkout, and receive confirmation and shipping emails while Pressline drives the Printful order and keeps an auditable ledger with nightly Reconciliation. A sample Engine, a CLI, a read-only Operator View, a render helper and documentation ship alongside.

## User Stories

### Engine developer

1. As an Engine developer, I want a documented HTTP protocol with published TypeScript schemas, so that I can integrate without reading Pressline's source.
2. As an Engine developer, I want to fetch the Catalog and the Printfile Spec for every Offer and variant from Pressline, so that I can pre-render Printfiles while the user is still in my app.
3. As an Engine developer, I want the render call to be idempotent on Design ID and Spec Hash, so that retries and pre-rendering never produce duplicate work.
4. As an Engine developer, I want to answer "still rendering" and have Pressline poll, so that a slow renderer does not break checkout.
5. As an Engine developer, I want to reject a Printfile Spec my Design cannot satisfy with a typed error, so that the Storefront can hide that Offer instead of failing later.
6. As an Engine developer, I want to declare which Offers a Design is eligible for and its aspect ratio, so that customers only see products that fit.
7. As an Engine developer, I want to mark a Design as not sellable, so that a shared link to a withdrawn design refuses to quote.
8. As an Engine developer, I want to optionally supply mockup images per Offer, so that my customers see a photoreal preview if I can produce one.
9. As an Engine developer, I want a render helper library that fits, pads, centers and stamps DPI for a Printfile Spec, so that I do not reinvent print preparation.
10. As an Engine developer, I want the render helper to run on Node and in WASM with an explicit byte budget, so that I know in advance which Offers my Worker-hosted Engine can render.
11. As an Engine developer, I want a conformance test suite I can point at my Engine, so that I know my implementation matches the protocol before going live.
12. As an Engine developer, I want a CLI command that validates any Printfile URL against an Offer's Printfile Spec, so that I can debug rendering quickly.
13. As an Engine developer, I want a sample Engine I can copy that works with zero third-party keys, so that I have a working starting point.
14. As an Engine developer building an AI-assisted app, I want a guide and a sample adapter for a hosted image model, so that I know how AI-generated raster output becomes a valid Printfile.
15. As an Engine developer, I want docs on Printful file formats, DPI, color, transparency, print areas and product limitations, so that my designs print as intended.
16. As an Engine developer, I want to hand a customer to the Storefront with a plain URL containing my Engine slug and Design ID, so that integration is one link.
17. As an Engine developer, I want the docs to state that Design IDs must be unguessable and Printfile URLs immutable, so that I design my storage correctly from the start.
18. As an Engine developer, I want the protocol versioned and checked at Pressline startup, so that incompatibilities surface at deploy time rather than during a sale.

### Customer

19. As a Customer, I want to click "Order a print" in the app I am using and land on a page showing my design, so that I can buy it without re-uploading anything.
20. As a Customer, I want to choose the product, size, color and my country, so that I see the right price before paying.
21. As a Customer, I want to see my design placed on a product photo, so that I can judge how it will look.
22. As a Customer, I want a price that includes shipping and tax and does not change after I see it, so that there are no surprises.
23. As a Customer, I want to pay on a familiar hosted payment page with card, wallet and local methods, so that I trust the transaction.
24. As a Customer, I want to enter my address once, so that checkout is fast.
25. As a Customer, I want to be told clearly before paying that a made-to-my-design item cannot be returned unless defective, so that I am not misled.
26. As a Customer, I want a confirmation email with my order, the design, and how to reach the seller quickly, so that I can fix a mistake such as a wrong size.
27. As a Customer, I want a shipping email with a tracking link, so that I know when my item will arrive.
28. As a Customer, I want an order-status page reachable from those emails without creating an account, so that I can check progress.
29. As a Customer, I want the order-status page not to reveal my full address to someone I forward the link to, so that my privacy is protected.
30. As a Customer, I want a shared design link to still work for me, so that I can buy the same design a friend made.
31. As a Customer, I want to be told to wait a moment if my design is still being prepared, and have the page continue automatically, so that a slow renderer does not confuse me.
32. As a Customer, I want a clear message if a design cannot be ordered, so that I do not waste time.

### Operator

33. As an Operator, I want to deploy Pressline to Cloudflare or Vercel with one click, so that I do not manage servers.
34. As an Operator, I want to deploy the sample Engine the same way, so that I can see the whole flow before writing my own.
35. As an Operator, I want to configure my Catalog, Engines, branding, legal wording and currency in one typed file, so that configuration is version-controlled and validated at boot.
36. As an Operator, I want to search Printful's catalog from the CLI and get an Offer snippet, so that I never have to look up variant IDs by hand.
37. As an Operator, I want a check that every Offer's variants exist and Printfile Specs resolve, so that a misconfiguration is caught before a customer hits it.
38. As an Operator, I want to set retail prices per Offer, so that pricing is my commercial decision.
39. As an Operator, I want shipping charged at Printful's live rate for the customer's country, so that I neither lose money nor overcharge.
40. As an Operator, I want tax computed automatically by Stripe, so that I do not maintain tax tables.
41. As an Operator, I want a `doctor` command that verifies secrets, Engines, Printful, Stripe and webhooks, so that I know an instance is healthy.
42. As an Operator, I want webhook endpoints registered by a command or shown with instructions, so that the post-deploy step is unambiguous.
43. As an Operator, I want a read-only view of orders, their transitions and provider references, so that I can answer a customer's question.
44. As an Operator, I want a single token to log into the view and drive the CLI, so that access is simple to manage and rotate.
45. As an Operator, I want every order transition recorded with its cause, so that I can explain what happened and why.
46. As an Operator, I want a nightly reconciliation that fixes missed webhooks and reports discrepancies, so that the ledger stays true without my attention.
47. As an Operator, I want to receive an email only when something needs me, so that I am not spammed on quiet nights.
48. As an Operator, I want to see the difference between the cost Printful quoted and what it charged, so that I can track my margin.
49. As an Operator, I want to resubmit an order Printful rejected or put on hold, so that I can recover without touching Printful's dashboard.
50. As an Operator, I want to fix a recipient address and resubmit, so that an address rejection does not require a refund.
51. As an Operator, I want to cancel an order via the CLI, so that a customer's change of mind before production is recorded correctly.
52. As an Operator, I want to create a manual order that was paid outside Stripe, so that I can handle reprints for defects and offline sales.
53. As an Operator, I want to purge customer personal data from completed orders after a retention period, so that I meet my data-protection obligations.
54. As an Operator, I want refunds I issue in Stripe's dashboard to show up as `refunded` in Pressline, so that the ledger matches my accounts without Pressline needing refund tooling.
55. As an Operator, I want a Demo Mode where no money or goods move but everything else is real, so that I can trial-run and demonstrate the flow.
56. As an Operator, I want Pressline to never take a payment for a design whose Printfile has not been validated, so that I never have to refund a bad file.
57. As an Operator, I want Pressline to never store image bytes, so that my storage costs and data exposure stay minimal.
58. As an Operator, I want to wire several Engines to one instance, so that multiple apps I control share one shop.
59. As an Operator, I want to brand the Storefront with my name, logo and colors, so that it looks like mine.
60. As an Operator, I want to link my own terms and privacy pages, so that legal pages are mine.
61. As an Operator, I want to turn on Stripe promotion codes with a flag, so that I can run a promotion without Pressline modeling discounts.
62. As an Operator, I want to run Pressline in a single currency of my choice, so that pricing is simple.
63. As an Operator, I want to see which Engines are failing their health check, so that I know when an integration is down.

### Contributor and maintainer

64. As a contributor, I want the whole test suite to run without any third-party keys, so that I can work on a fork.
65. As a contributor, I want provider adapters tested against recorded fixtures, so that I can change an adapter safely.
66. As a maintainer, I want a nightly live smoke test against real Printful and Stripe test mode that never spends money, so that I learn when Printful's beta API shifts.
67. As a contributor, I want an Effect primer in the contributor guide, so that the single-idiom codebase is approachable.
68. As a maintainer, I want the demo shop to be exactly the deploy template plus a Demo Mode flag, so that the demo never drifts from what users deploy.
69. As a maintainer, I want the project under MIT and the docs under CC BY 4.0, so that adoption is frictionless.

## Implementation Decisions

### Shape (ADR 0001, 0011, 0012, 0013, 0014)

- One Operator per instance. No tenant concept anywhere.
- One deployable per platform: a SvelteKit application packaged by the official Cloudflare and Vercel adapters. Storefront and Operator View pages are SvelteKit routes. The Effect `HttpApi` is mounted from the server hook and owns the JSON API, the operator API, the Engine-facing endpoints and the webhook endpoints.
- Effect throughout: `@effect/platform` for HTTP, `Schema` for all contracts and configuration, `Layer` for every external dependency, `Schedule` for polling and reconciliation. Persistence is Pressline's own three-method `Db` service (`run`, `all`, `batch`) over each platform's native driver, with an in-house migrator (ADR-0011).
- Five external interfaces, each with one shipped implementation plus in-memory and (where useful) `none`/`console` implementations: `DesignSource` (HTTP client to an Engine), `FulfillmentProvider` (Printful v2), `PSP` (Stripe Checkout), `Mailer` (Resend), `Db` (SQLite dialect: D1, libSQL, file). Effect's built-in `Clock` is used everywhere time is read, so tests inject a settable one.
- Effect runtime is built from platform bindings per request and memoised per isolate.
- Scheduled Reconciliation has a per-platform shim: a Cloudflare cron `scheduled` export and a Vercel cron hitting an operator-token-protected route. The same entry is callable from the CLI.
- Migrations run at boot on first request per isolate. Each migration's statements and its `migrations` bookkeeping row go in one `batch`; the row's primary key is the concurrency guard, and a migrator that loses a race re-reads the applied set and carries on (ADR-0012). No interactive transactions anywhere; every logical write is one `batch`.
- pnpm workspace: applications (pressline, sample-engine, docs), published packages (`@pressline/contract`, `@pressline/render`, `@pressline/cli`), and deploy templates for both platforms pointing at the applications. The bridge is not published as a library.
- Configuration is a typed file validated by `Schema` at boot (Catalog, Engines, branding, Withdrawal Notice wording, terms and privacy URLs, currency, Demo Mode, promotion-code flag, operator email); secrets come from platform environment (Printful token, Stripe secret and webhook secret, Resend key, per-Engine shared secrets, operator token, session-signing secret). The Operator View never edits configuration.

### Catalog (ADR 0006, 0010)

- An Offer has: slug, display name, product family, a map from variant key (size/color) to Printful catalog variant ID, a Placement key, print technique, retail price in the instance currency, and a product photo URL per color.
- The public catalog endpoint returns every Offer with, per variant, the Printfile Spec resolved from Printful's catalog. Resolution is cached in the database with a TTL and refreshed by `catalog check` and Reconciliation.
- Printfile Spec fields: width and height in pixels, DPI, allowed formats (PNG required for transparency; JPEG allowed only where the placement has no transparency), color space (sRGB), whether alpha is required/allowed/forbidden, Placement key, technique. It has a canonical JSON serialization (sorted keys, no whitespace, integers only) whose SHA-256 is the Spec Hash. The canonicaliser lives in `@pressline/contract` and is the only implementation both sides use.
- Eligibility = Offers in the Catalog ∩ Offer slugs the Engine lists for the Design (absent = all), further filtered by aspect compatibility (an Offer may declare the aspect range it accepts).

### DesignSource protocol v1 (ADR 0002, 0003, 0004, 0005)

Engine-side endpoints, all under a per-Engine base URL, authenticated by a bearer shared secret Pressline sends:

- `GET /designs/{designId}` → `200 { id, title?, sellable, previewUrl, aspect: {w,h}, offers?: string[], mockups?: { [offerSlug]: url }, engineRef? }` or `404 { _tag: "DesignNotFound", designId }`. Design IDs are URL-safe, 8–128 characters; entropy is the Engine's obligation.
- `POST /designs/{designId}/printfile` with a Printfile Spec body → `200 { status: "ready", url, sha256, width, height, bytes, contentType, specHash }`, or `202 { status: "rendering", retryAfterMs }`, or `422 { _tag: "PrintfileRejected", code: aspect_mismatch | unsupported_format | design_not_sellable | other, message }`. The exact schemas live in `@pressline/contract`, which is the normative source; the shapes here are a summary.
- `GET /health` → `{ protocolVersion }`. Checked at startup and by `doctor`; a mismatch is an Alarm and the Engine is disabled.

Pressline-side endpoints an Engine may call without credentials: the public catalog endpoint (Offers, variants, Printfile Specs) and a helper that returns the Storefront URL for a Design.

Rules:

- Pressline pulls; the Engine hosts Printfile and Preview bytes at immutable, publicly fetchable URLs. Pressline stores URLs and metadata only, never bytes.
- The ensure-Printfile call is made before the Stripe session is created. Pressline polls with a bounded wait; if still `202`, the Storefront returns a "preparing" state and the page polls Pressline.
- Validation fetches only the header bytes of the Printfile URL (range request, falling back to a bounded read) and checks format, dimensions, color type and alpha against the Spec, and that `specHash` echoes the one sent. Content length is checked against `bytes`. Full-file hashing is not performed. Failures are typed and surfaced on the Storefront as "this design cannot be ordered on this product".
- Storefront entry is a plain public URL containing Engine slug and Design ID. No signing.
- Protocol is versioned by a single constant carried in `@pressline/contract` and `/health`.

### Storefront (ADR 0010, 0012)

- Pages: design/product page (Preview, Offer picker, variant picker, country picker, Mockup, Quote, Withdrawal Notice, continue button), preparing page (polling), Stripe redirect, thank-you page, order-status page (token-gated), not-found/not-sellable page.
- Mockup in v1 is the Preview overlaid on the Offer's product photo using the Placement's proportions, or the Engine-supplied image for that Offer if present.
- Quote = Offer retail price + Printful shipping rate for (variant, country), tax added by Stripe Automatic Tax. The Quote is stored on the Order together with the Provider Cost Estimate (Printful product cost + shipping cost).
- Stripe Checkout session: payment mode; one line item (the product) plus a fixed-amount shipping option so Stripe taxes shipping correctly; automatic tax on; shipping address collection with allowed countries locked to the quoted country; phone collection on; email collected; no Stripe Customer; consent collection required with the Withdrawal Notice as custom terms text; Stripe receipt emails off; promotion codes per config flag; expiry one hour; success and cancel URLs on the Storefront; `client_reference_id` and metadata carry the Order ID.
- Theming: name, logo, accent colors from config; English only.

### Order ledger (ADR 0008, 0009)

- Tables: orders (current state, Engine slug, Design ID, Offer slug, variant key, Printfile URL and metadata, Spec Hash, Quote, Provider Cost Estimate, currency, Recipient, consent record, Stripe session and payment-intent IDs, Printful order ID, tracking, status token, timestamps), order_transitions (append-only: order, from, to, cause, cause reference, at), inbound_events (provider, provider event ID unique, received at, processed at, outcome, payload), catalog_cache, migrations.
- States and transitions exactly as ADR 0009. Terminal: `expired`, `fulfilled`, `canceled`, `refunded`. Every transition names a Cause: `stripe_webhook`, `printful_webhook`, `cli`, `reconciliation`, `storefront` (session creation and expiry by Pressline itself).
- Order created at Stripe session creation with a UUIDv7 ID and a random status token.
- Webhook handling: verify signature (Stripe always; Printful v2 signature), insert the Inbound Event by provider event ID (ignore if present), re-fetch the referenced object from the provider, then apply a Transition if the state machine permits. Payload contents never drive a Transition directly.
- Submit (`paid → submitted`): look up provider order by `external_id` (the Order ID); if none, create a draft with variant, Printfile URL as the placement file, Recipient, external_id; compare draft variant and destination country with the Order (mismatch → `submit_failed`); log the cost delta; confirm. Any provider rejection classed as non-retryable → `submit_failed`; retryable errors retry with backoff within the handler's time budget, then leave the Order in `paid` for Reconciliation.
- Emails: confirmation on `paid` (Order summary, Preview, Withdrawal Notice, Operator contact, status link); shipped on `shipped` (tracking link, status link). Sent through `Mailer`; a failed send is recorded and retried by Reconciliation, never blocks a Transition.
- Reconciliation steps and Alarms as agreed: expired sessions, stuck `paid`, provider status catch-up, refunds and disputes via Stripe, unprocessed Inbound Events, failed emails, Engine health, catalog cache refresh, and an emailed report only when Alarms exist.
- PII purge removes Recipient fields and consent details from terminal Orders older than a threshold, leaving country and totals for reporting.

### Operator surface (ADR 0014)

- Operator View: login with the operator token setting a signed HttpOnly cookie; pages for order list (filter by state), order detail (Transitions, Inbound Events, provider references, links to Stripe and Printful dashboards), last Reconciliation report, instance health (Engines, webhooks registered, config summary). Read-only.
- Operator API (bearer token): the same data plus actions used by the CLI: create manual order, resubmit, fix address, cancel, purge, reconcile, catalog check, webhook register, printfile check.
- CLI commands as agreed in the interview: `doctor`, `catalog search|check`, `webhooks register`, `orders list|show|create|resubmit|fix-address|cancel|purge`, `reconcile`, `printfile check`. The CLI never touches the database.

### Demo Mode

- Config flag. Stripe keys are test-mode keys; the Storefront shows the test card number; the `FulfillmentProvider` layer is the real Printful adapter with `confirm` replaced by a cancel of the draft, so Orders reach `submitted` with a canceled provider draft and then `canceled`. Operator View is publicly readable in Demo Mode.

### `@pressline/render`

- One function: input image (PNG, JPEG or SVG) + Printfile Spec + options (fit mode: contain/cover, background color or transparent, alignment) → PNG bytes with DPI metadata, sRGB, alpha per Spec.
- Backends: `node` (sharp) and `wasm` (resvg for SVG, WASM decode/resize/encode for raster). The WASM backend enforces a configurable raw-bitmap byte budget and fails with a typed error when a Spec exceeds it.
- Never imported by the bridge application.

### Sample Engine

- SvelteKit app implementing the protocol. Deterministic template designer (text, color, a few shapes) producing SVG; on finalize it stores a Design with an unguessable ID, fetches the public catalog, renders a Printfile per Offer/variant with `@pressline/render`, and serves Preview and Printfiles from its own `FileStore` (R2 on Cloudflare, Vercel Blob on Vercel, filesystem locally). Optional AI adapter behind an interface, enabled when a key is present. Ships with its own deploy templates.

### Docs

- Static docs site (built from `apps/docs`, published on GitHub Pages): Operator guide (deploy, configure, go live, Demo Mode, legal wording review), Engine developer guide (protocol, pre-rendering, hosting rules, conformance suite, AI-assisted engines), print preparation reference (formats, DPI, color, transparency, print areas, product limitations, Worker-fit table), contributor guide (Effect primer, test layers, fixtures refresh), CLI reference, generated OpenAPI for the JSON API.

## Testing Decisions

A good test drives the system through a boundary a real caller uses and asserts only what that caller can observe: responses, subsequent reads, and what the fake external services received. Tests never reach into the ledger tables or Effect internals to assert state.

Seams, from highest to lowest:

1. **HTTP surface of the bridge** with in-memory `DesignSource`, `FulfillmentProvider`, `PSP`, `Mailer`, a controllable `Clock`, and `Db` on a SQLite file. Full-flow tests: quote → session → simulated Stripe webhook → observed draft/confirm on the fake provider → simulated Printful webhook → operator API shows Transitions and emails sent. Idempotency (same webhook twice), out-of-order webhooks, unsigned webhooks, the sync-or-202 path, validation failures, Demo Mode, every CLI-backed operator action, and every Reconciliation step (by advancing the clock and calling the cron entry) live here. Playwright e2e for the Storefront pages runs on the same seam.
2. **Adapter contract tests** for Printful v2, Stripe and Resend against a fixture server replaying recorded responses, including signed and malformed webhooks and error shapes. A maintainer-run script refreshes fixtures with real keys. The nightly live smoke runs the same adapter tests against real endpoints (Stripe test mode; Printful drafts that are deleted; confirm replaced) and is skipped when secrets are absent.
3. **`@pressline/render`**: bytes + Spec → bytes, asserted by parsing PNG headers (dimensions, DPI, color type, alpha); the suite runs against both backends; the byte-budget refusal is asserted on the WASM backend.
4. **DesignSource conformance suite** in `@pressline/conformance` (built on the validator in `@pressline/contract`): given a base URL and a Design ID, verifies the protocol (metadata shape, 202-then-200, identical URL on repeat, Spec Hash echo, header validity of the returned file, 422 on an impossible Spec, health). The sample Engine's own tests are this suite run in-process; Engine developers run it against theirs.

No prior art exists in the repository; these seams set it.

## Out of Scope

Everything in ADR 0015: multi-item carts, customer accounts, refund and customer-cancellation tooling, discount modeling, additional providers or PSPs, an embeddable widget, Printful mockup generation in core, Printful sync products, multi-currency, a settings UI, multi-tenancy, digital goods, a delivered state. Also out of scope for v1: localization of Storefront and emails, signed Storefront links, a public design gallery, analytics, and any Pressline-hosted file storage.

## Further Notes

- Printful API v2 is Open Beta as of September 2026 (ADR 0007). The adapter is the only place its shapes appear; the ledger never mirrors provider payloads.
- Assumptions taken without discussion and easy to change: the docs site generator (Astro Starlight), one-hour Stripe session expiry, English-only surfaces.
- Legal wording shipped in the sample configuration is a template and must carry a "review with counsel" note.
- Sample Engine demo assets must be original or explicitly licensed.
- Domains: the docs site is served at `pressline.0xff.sh` (GitHub Pages; the name lives in `apps/docs/public/CNAME` and the workflow's `DOCS_SITE`). The bridge and the sample Engine have no domain of their own: the demo instance runs on its platform's own subdomains. No other vanity domain appears in rendered pages, diagrams or the Storefront.
