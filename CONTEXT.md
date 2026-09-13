# Pressline

A self-hostable bridge from an image-generating app to physical print-on-demand products. Pressline owns ordering, payment and fulfillment; the design itself comes from outside.

## Language

### Parties

**Operator**:
The single person or organization that deploys a Pressline instance and owns the Printful and Stripe accounts it uses. One instance, one Operator.
_Avoid_: Tenant, merchant, admin, shop owner

**Engine**:
An external application, controlled by the Operator, that produces designs and implements the DesignSource contract. An instance may be wired to several Engines; all are trusted.
_Avoid_: Image-generating app, design app, source, provider (reserved for fulfillment)

**Engine developer**:
The person who builds and runs an Engine and integrates it against the DesignSource contract. Often the same person as the Operator wearing a different hat: the Operator owns the instance and its accounts, the Engine developer owns the design tool.
_Avoid_: Integrator, developer (alone), partner

**Customer**:
A person who buys a product bearing a design.
_Avoid_: User, buyer, client, account

### Contracts

**DesignSource**:
The contract an Engine implements so Pressline can obtain a design's print-ready file, its preview, and its product/placement spec.
_Avoid_: Engine API, plugin, adapter

### Design and files

**Design**:
A piece of artwork an Engine has produced, identified by an Engine-scoped, unguessable Design ID. The thing a Customer buys printed on a product. A Design's Storefront URL is public and shareable.
_Avoid_: Image, artwork (use for the raw pixels only), generation

**Printfile**:
The finished, print-ready file for one Design on one Placement: exact pixel dimensions, DPI and transparency as the fulfillment provider requires. Produced by the Engine, validated by Pressline.
_Avoid_: Print file, asset, render, output

**Printfile Spec**:
The requirements a Printfile must satisfy for a given Product and Placement (dimensions, DPI, format, color, transparency). Pressline derives it from the fulfillment provider and hands it to the Engine. Canonically serializable, so Pressline and Engine compute the same Spec Hash.
_Avoid_: Dims, constraints, requirements

**Spec Hash**:
The stable hash of a Printfile Spec. Together with a Design ID it identifies exactly one Printfile and is the idempotency key for rendering.
_Avoid_: Job ID, render ID

**Printfile Level**:
How much of a print a Printfile can express. Level 1 is one raster covering the whole print area at the Spec's size, and is all that v1 asks; later levels add density ranges, vector, technique constraints and layout. The Spec Hash covers only the level-1 core.
_Avoid_: Tier, profile, format version

**Preview**:
A customer-facing image of the Design (optionally mocked up on the product). Never used for printing.
_Avoid_: Thumbnail, mockup (that is one kind of Preview)

**Rendering**:
Turning a Design into a Printfile that satisfies a Printfile Spec. Done by the Engine, never by Pressline.

**Validation**:
Pressline checking a Printfile against its Printfile Spec by inspecting the file, without decoding or altering pixels.

**Deviation**:
A Printfile that satisfies its Printfile Spec but departs from the file requirements the protocol documents or the fulfillment provider promotes. Recorded and surfaced, never blocking, never an Alarm.
_Avoid_: Warning, advisory, lint, finding (that is Reconciliation's)

**Inspection**:
What looking at one Printfile concluded: what its header said, what Validation would refuse, and which Deviations it carries. An Inspection is the same whoever looked and however the bytes arrived, so Validation and Preflight can never describe the same file differently.
_Avoid_: Check, result, report

**Conformance**:
An Engine developer's check of a live Engine against the DesignSource protocol, run before wiring it to an instance. Exercises every rule the way Pressline does and reports the Inspection of the Printfile the Engine really produced, Deviations included; a deviating Engine is conformant unless the developer asks for strictness.
_Avoid_: Compliance, certification, validation (that is Pressline's act on one file)

**Preflight**:
An Engine developer's local check of a Printfile against a Printfile Spec and the protocol's file requirements, before the file is hosted. Reports what Validation would refuse and any Deviations; guarantees nothing to anyone but the developer.
_Avoid_: Validate (that is Validation, Pressline's act), lint, check

**Printfile URL**:
The immutable, publicly fetchable address at which the Engine hosts a Printfile. Pressline validates against it and hands the same URL to the fulfillment provider, which may re-fetch it months later.
_Avoid_: File link, asset URL, download URL

### Catalog

**Catalog**:
The Operator-curated set of Offers a Pressline instance sells. Owned by Pressline; the Engine never sees fulfillment-provider identifiers.
_Avoid_: Products (ambiguous with Printful's catalog), store, inventory

**Offer**:
One sellable thing in the Catalog: a product family, a Placement, a print technique and a retail price, referenced by a stable slug (e.g. `tee-black-front`). A Customer buys one Offer bearing one Design.
_Avoid_: Product, SKU, listing, item

**Placement**:
The printable area on a product where a Design goes (front, back, sleeve, full-wrap). Each Offer has exactly one.
_Avoid_: Print area, position, side

**Eligibility**:
Which Offers a given Design may be sold on: the Catalog intersected with the Offer slugs the Engine lists for that Design (default: all).
_Avoid_: Supported products, compatibility

### Fulfillment and payment

**Fulfillment Provider**:
The service that prints and ships an Order. Printful is the only shipped implementation.
_Avoid_: Provider (alone), vendor, supplier, printer

**PSP**:
The payment service provider that takes the Customer's money. Stripe Checkout is the only shipped implementation.
_Avoid_: Payment gateway, processor

### Orders

**Order**:
One Customer's purchase of one Offer bearing one Design, tracked from quote to delivery. Pressline's own record; the fulfillment provider's order and the PSP's session are references on it, not the thing itself.
_Avoid_: Purchase, transaction, checkout, Printful order (say "provider order")

**Transition**:
One recorded move of an Order from one state to another, always with a Cause.
_Avoid_: Event (reserved for Inbound Event), status change, update

**Cause**:
What made a Transition happen: a PSP webhook, a provider webhook, an operator action via the CLI, or Reconciliation. Every Transition names one.
_Avoid_: Source, trigger, reason

**Inbound Event**:
A webhook delivery received from the PSP or the fulfillment provider, recorded by the provider's event ID so it is processed at most once.
_Avoid_: Webhook (the mechanism), notification, message

**Reconciliation**:
The scheduled comparison of every open Order against the PSP and the fulfillment provider, producing Transitions for anything the webhooks missed.
_Avoid_: Sync, cron, repair

### Selling

**Storefront**:
The Pressline-hosted customer-facing pages: choose an Offer and its variant, choose destination country, see the Quote, proceed to the PSP. Everything before it belongs to the Engine; everything after it belongs to the PSP.
_Avoid_: Widget, checkout page, shop, frontend (ambiguous with the Engine's UI)

**Quote**:
The locked price for one Order: Offer retail price plus the fulfillment provider's shipping rate for the chosen country, with tax added by the PSP. What the Customer pays; never adjusted after payment.
_Avoid_: Estimate (that word is reserved for the Operator's cost), price calculation

**Provider Cost Estimate**:
What the fulfillment provider quoted the Operator for product and shipping at Quote time. May differ from the final provider invoice; the Operator absorbs the difference.
_Avoid_: Cost, wholesale price, margin basis

**Sellable**:
Whether the Engine currently permits a Design to be ordered. Declared by the Engine per Design; a non-sellable Design has a Storefront page that refuses to quote.
_Avoid_: Published, active, enabled

**Recipient**:
The name, postal address, email and phone the Customer entered at the PSP, copied onto the Order and sent to the fulfillment provider. The only personal data Pressline stores.
_Avoid_: Shipping details, address, contact

**Mailer**:
The service that delivers Customer emails (order confirmation with the withdrawal-exemption wording, shipped-with-tracking). Resend is the only shipped implementation; `none` and `console` exist for setup and tests.
_Avoid_: Notifier, email provider, SMTP

**Mockup**:
A Preview of the Design placed on a product image. Either the Storefront's overlay of the Preview on the Offer's product photo, or an Engine-supplied image per Offer. Illustrative only.
_Avoid_: Render, product preview

**Operator View**:
The read-only, authenticated pages where the Operator inspects Orders, Transitions, Reconciliation results and instance health. Configuration is never edited here.
_Avoid_: Admin, dashboard, back office, settings

**Alarm**:
A Reconciliation finding that needs the Operator: an Order stuck in `paid`, `submit_failed` or `on_hold`, a refund or dispute, an Engine failing its health check, an Offer that no longer resolves, or a Customer email that keeps failing. Alarms are emailed to the Operator; quiet nights send nothing.
_Avoid_: Alert, notification, warning

**Demo Mode**:
An instance configured so no money and no goods move: the PSP runs in test mode and the fulfillment provider creates drafts but never confirms them. Everything else is real. The demo instance runs this way.
_Avoid_: Sandbox, test mode (the PSP's own term), staging

**Withdrawal Notice**:
The Operator-configured wording, shown on the Storefront and accepted at the PSP before payment, stating that made-to-design goods are exempt from the withdrawal right and that returns are for defects only. Acceptance is recorded on the Order and repeated in the confirmation email.
_Avoid_: Terms, T&Cs (those are the Operator's separate documents), disclaimer
