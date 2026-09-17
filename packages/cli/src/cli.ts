import { createRequire } from 'node:module'
import { Args, Command, Options } from '@effect/cli'
import {
  CatalogResponse,
  describeHeader,
  formatInspection,
  ImageHeader,
  inspectionFails,
} from '@pressline/contract'
import { Config, Effect, Option, Schema } from 'effect'
import { api, failWith, Instance, publicGet } from './client.js'
import { engine } from './engine.js'
import { strict } from './options.js'
import { print } from './output.js'
import { groupBySpec, specSummary } from './spec-source.js'

/**
 * `pressline` — the command line for one instance. The Operator's commands
 * are thin clients of the operator API; nothing here reaches the database or
 * the providers directly (ADR-0014). The Engine developer's commands
 * (`offers`, `engine …`) read public endpoints or the Engine itself and need
 * no token.
 */
const url = Options.text('url').pipe(
  Options.withDescription('Base URL of the Pressline instance; `engine …` commands do not need it'),
  Options.withFallbackConfig(Config.string('PRESSLINE_URL')),
  Options.optional,
)
const token = Options.redacted('token').pipe(
  Options.withDescription('Operator token; only the Operator commands need it'),
  Options.withFallbackConfig(Config.redacted('PRESSLINE_TOKEN')),
  Options.optional,
)

const mark = (ok: boolean) => (ok ? '✓' : '✗')

// ---- doctor ---------------------------------------------------------------

const Health = Schema.Struct({
  engines: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      enabled: Schema.Boolean,
      reason: Schema.optional(Schema.String),
    }),
  ),
  webhooks: Schema.Struct({
    stripe: Schema.Struct({
      configured: Schema.Boolean,
      url: Schema.optional(Schema.String),
      detail: Schema.optional(Schema.String),
    }),
    printful: Schema.Struct({
      configured: Schema.Boolean,
      url: Schema.optional(Schema.String),
      detail: Schema.optional(Schema.String),
    }),
  }),
  config: Schema.Struct({
    name: Schema.String,
    currency: Schema.String,
    offers: Schema.Number,
    demo: Schema.Boolean,
    mailer: Schema.String,
  }),
  providers: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({ ok: Schema.Boolean, detail: Schema.optional(Schema.String) }),
  }),
  secrets: Schema.Record({ key: Schema.String, value: Schema.Boolean }),
  schema: Schema.Struct({ version: Schema.Number, latest: Schema.Number }),
})

const REQUIRED_SECRETS = ['printful', 'stripe', 'stripeWebhook', 'printfulWebhook', 'sessionSecret']

const doctor = Command.make('doctor', {}, () =>
  Effect.gen(function* () {
    const h = yield* api('GET', '/api/operator/health', Health)
    const problems: string[] = []
    const lines: string[] = [
      `${h.config.name} (${h.config.currency}, ${h.config.offers} offers, demo ${h.config.demo ? 'on' : 'off'}, mailer ${h.config.mailer})`,
      `${mark(h.schema.version === h.schema.latest)} schema v${h.schema.version} of ${h.schema.latest}`,
    ]
    for (const name of REQUIRED_SECRETS) {
      const present = h.secrets[name] ?? false
      lines.push(`${mark(present)} secret ${name}`)
      if (!present) problems.push(`secret ${name} is not set`)
    }
    for (const [name, p] of Object.entries(h.providers)) {
      lines.push(`${mark(p.ok)} ${name} ${p.ok ? 'reachable' : `unreachable: ${p.detail ?? ''}`}`)
      if (!p.ok) problems.push(`${name} is unreachable`)
    }
    for (const e of h.engines) {
      lines.push(`${mark(e.enabled)} engine ${e.slug}${e.reason ? `: ${e.reason}` : ''}`)
      if (!e.enabled) problems.push(`engine ${e.slug} is disabled`)
    }
    for (const [name, w] of Object.entries(h.webhooks)) {
      lines.push(
        `${mark(w.configured)} ${name} webhook ${w.configured ? w.url : `not registered${w.detail ? ` (${w.detail})` : ''}`}`,
      )
      if (!w.configured)
        problems.push(`${name} webhook is not registered (run: pressline webhooks register)`)
    }
    yield* print(...lines)
    if (problems.length > 0)
      return yield* failWith(`${problems.length} problem(s): ${problems.join('; ')}`)
  }),
).pipe(Command.withDescription('Check the instance: config, secrets, Engines, providers, webhooks'))

// ---- catalog ------------------------------------------------------------

const Spec = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  dpi: Schema.Number,
  formats: Schema.Array(Schema.String),
  alpha: Schema.String,
})

const SearchResult = Schema.Struct({
  products: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      placements: Schema.Array(
        Schema.Struct({
          placement: Schema.String,
          technique: Schema.String,
          spec: Schema.NullOr(Spec),
        }),
      ),
      variants: Schema.Array(
        Schema.Struct({
          id: Schema.Number,
          name: Schema.String,
          color: Schema.optional(Schema.String),
          size: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
})

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')

/** An Offer the Operator can paste into `pressline.config.ts`, with every variant keyed by color and size. */
const offerSnippet = (p: (typeof SearchResult.Type)['products'][number]) => {
  const method = p.placements[0]
  const variants = p.variants
    .map((v) => {
      const key = slugify([v.color, v.size].filter(Boolean).join(' ') || v.name)
      const fields = [
        `catalogVariantId: ${v.id}`,
        `label: ${JSON.stringify([v.color, v.size].filter(Boolean).join(' / ') || v.name)}`,
        ...(v.color ? [`color: ${JSON.stringify(v.color)}`] : []),
        ...(v.size ? [`size: ${JSON.stringify(v.size)}`] : []),
      ]
      return `      '${key}': { ${fields.join(', ')} },`
    })
    .join('\n')
  return [
    `  {`,
    `    slug: '${slugify(p.name)}',`,
    `    name: ${JSON.stringify(p.name)},`,
    `    catalogProductId: ${p.id},`,
    `    placement: '${method?.placement ?? 'front'}',`,
    `    technique: '${method?.technique ?? 'dtg'}',`,
    `    retailPrice: 2500, // minor units (25.00): set your price`,
    `    variants: {`,
    variants,
    `    },`,
    `  },`,
  ].join('\n')
}

const searchText = Args.text({ name: 'text' }).pipe(
  Args.withDescription('Words of the product name'),
)

const catalogSearch = Command.make('search', { text: searchText }, ({ text }) =>
  Effect.gen(function* () {
    const { products } = yield* api(
      'GET',
      `/api/operator/catalog/search?q=${encodeURIComponent(text)}`,
      SearchResult,
    )
    if (products.length === 0) return yield* print(`No products match "${text}".`)
    for (const p of products) {
      yield* print(`${p.id}  ${p.name}`)
      for (const m of p.placements) {
        const spec = m.spec
          ? `${m.spec.width}×${m.spec.height}px @ ${m.spec.dpi} dpi, ${m.spec.formats.join('/')}, alpha ${m.spec.alpha}`
          : 'no print area known'
        yield* print(`    ${m.placement} / ${m.technique}: ${spec}`)
      }
      for (const v of p.variants) {
        yield* print(`    variant ${v.id}  ${v.name}`)
      }
      yield* print('  Offer snippet for pressline.config.ts:', offerSnippet(p), '')
    }
  }),
).pipe(Command.withDescription('Find provider products by name; prints Specs and an Offer snippet'))

const CheckResult = Schema.Struct({
  offers: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      ok: Schema.Boolean,
      variants: Schema.Number,
      message: Schema.optional(Schema.String),
    }),
  ),
})

const catalogCheck = Command.make('check', {}, () =>
  Effect.gen(function* () {
    const { offers } = yield* api('GET', '/api/operator/catalog/check', CheckResult)
    for (const o of offers) {
      yield* print(`${mark(o.ok)} ${o.slug}: ${o.ok ? `${o.variants} variants` : o.message}`)
    }
    const bad = offers.filter((o) => !o.ok)
    if (bad.length > 0)
      return yield* failWith(`${bad.length} of ${offers.length} Offers do not resolve`)
    yield* print(`All ${offers.length} Offers resolve.`)
  }),
).pipe(Command.withDescription('Verify every configured Offer resolves at the provider'))

const catalog = Command.make('catalog').pipe(
  Command.withDescription('Provider catalog tools'),
  Command.withSubcommands([catalogSearch, catalogCheck]),
)

// ---- webhooks -------------------------------------------------------------

const Registration = Schema.Union(
  Schema.Struct({
    status: Schema.Literal('created', 'verified'),
    url: Schema.String,
    secret: Schema.optional(Schema.String),
    publicKey: Schema.optional(Schema.String),
  }),
  Schema.Struct({ status: Schema.Literal('failed'), url: Schema.String, message: Schema.String }),
)
const RegisterResult = Schema.Struct({ stripe: Registration, printful: Registration })

const publicUrl = Options.text('public-url').pipe(
  Options.withDescription('Public https origin of the instance (defaults to checkout.publicUrl)'),
  Options.optional,
)

const webhooksRegister = Command.make('register', { publicUrl }, ({ publicUrl }) =>
  Effect.gen(function* () {
    const r = yield* api(
      'POST',
      '/api/operator/webhooks/register',
      RegisterResult,
      Option.isSome(publicUrl) ? { publicUrl: publicUrl.value } : {},
    )
    let secrets = false
    let failures = 0
    for (const [name, reg] of [
      ['Stripe', r.stripe],
      ['Printful', r.printful],
    ] as const) {
      if (reg.status === 'failed') {
        failures++
        yield* print(`✗ ${name} ${reg.url}: ${reg.message}`)
        continue
      }
      yield* print(`✓ ${name} ${reg.status} ${reg.url}`)
      if (reg.secret) {
        secrets = true
        yield* print(`  set ${name.toUpperCase()}_WEBHOOK_SECRET=${reg.secret}`)
      }
      if (reg.publicKey) yield* print(`  set PRINTFUL_WEBHOOK_PUBLIC_KEY=${reg.publicKey}`)
    }
    if (secrets)
      yield* print('Secrets are shown once: store them in the deployment now, then redeploy.')
    if (failures > 0) {
      return yield* failWith(
        `${failures} provider(s) could not be registered; run again after fixing`,
      )
    }
  }),
).pipe(Command.withDescription('Create or verify the Stripe and Printful webhook endpoints'))

const webhooks = Command.make('webhooks').pipe(
  Command.withDescription('Webhook endpoints at the providers'),
  Command.withSubcommands([webhooksRegister]),
)

// ---- orders ---------------------------------------------------------------

const OrderRow = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  engine: Schema.String,
  designId: Schema.String,
  offer: Schema.String,
  variant: Schema.String,
  country: Schema.String,
  currency: Schema.String,
  retail: Schema.Number,
  shipping: Schema.Number,
  amountTotal: Schema.optional(Schema.Number),
  providerOrderId: Schema.optional(Schema.String),
})
const OrderList = Schema.Struct({
  orders: Schema.Array(OrderRow),
  nextCursor: Schema.optional(Schema.String),
})
const OrderDetail = Schema.Struct({
  order: OrderRow.pipe(
    Schema.extend(
      Schema.Struct({
        recipient: Schema.optional(
          Schema.Struct({ name: Schema.String, country: Schema.String, email: Schema.String }),
        ),
        purgedAt: Schema.optional(Schema.Number),
      }),
    ),
  ),
  transitions: Schema.Array(
    Schema.Struct({
      at: Schema.Number,
      from: Schema.optional(Schema.NullOr(Schema.String)),
      to: Schema.String,
      cause: Schema.String,
      causeRef: Schema.optional(Schema.String),
      note: Schema.optional(Schema.String),
    }),
  ),
  inboundEvents: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      eventId: Schema.String,
      eventType: Schema.String,
      outcome: Schema.optional(Schema.String),
    }),
  ),
  emails: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      sentAt: Schema.optional(Schema.Number),
      attempts: Schema.Number,
    }),
  ),
})

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
const money = (amount: number, currency: string) => {
  const f = new Intl.NumberFormat('en', { style: 'currency', currency })
  return f.format(amount / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2))
}

const state = Options.text('state').pipe(
  Options.withDescription('Only Orders in this state'),
  Options.optional,
)
const limit = Options.integer('limit').pipe(Options.withDefault(50))

const ordersList = Command.make('list', { state, limit }, ({ state, limit }) =>
  Effect.gen(function* () {
    const q = new URLSearchParams({ limit: String(limit) })
    if (Option.isSome(state)) q.set('state', state.value)
    const { orders } = yield* api('GET', `/api/operator/orders?${q}`, OrderList)
    if (orders.length === 0) return yield* print('No orders.')
    for (const o of orders) {
      yield* print(
        `${o.id}  ${iso(o.updatedAt)}  ${o.state.padEnd(14)} ${o.offer}/${o.variant} → ${o.country}  ${money(o.amountTotal ?? o.retail + o.shipping, o.currency)}`,
      )
    }
  }),
).pipe(Command.withDescription('List Orders, newest first'))

const orderId = Args.text({ name: 'id' })

const ordersShow = Command.make('show', { orderId }, ({ orderId }) =>
  Effect.gen(function* () {
    const d = yield* api('GET', `/api/operator/orders/${encodeURIComponent(orderId)}`, OrderDetail)
    const o = d.order
    yield* print(
      `Order ${o.id}  ${o.state}`,
      `  ${o.engine}/${o.designId}  ${o.offer}/${o.variant}  ${money(o.amountTotal ?? o.retail + o.shipping, o.currency)} → ${o.country}`,
      ...(o.recipient ? [`  ${o.recipient.name} <${o.recipient.email}>`] : []),
      ...(o.purgedAt ? [`  personal data purged ${iso(o.purgedAt)}`] : []),
      ...(o.providerOrderId ? [`  provider order ${o.providerOrderId}`] : []),
      'Transitions:',
      ...d.transitions.map(
        (t) =>
          `  ${iso(t.at)}  ${t.from ?? '—'} → ${t.to}  (${t.cause}${t.causeRef ? ` ${t.causeRef}` : ''})${t.note ? `  ${t.note}` : ''}`,
      ),
    )
    if (d.inboundEvents.length > 0) {
      yield* print(
        'Inbound events:',
        ...d.inboundEvents.map(
          (e) => `  ${e.provider} ${e.eventType} ${e.eventId}: ${e.outcome ?? 'pending'}`,
        ),
      )
    }
    if (d.emails.length > 0) {
      yield* print(
        'Emails:',
        ...d.emails.map(
          (e) =>
            `  ${e.kind}: ${e.sentAt ? `sent ${iso(e.sentAt)}` : `not sent (${e.attempts} attempts)`}`,
        ),
      )
    }
  }),
).pipe(Command.withDescription('Show one Order with its Transitions, Inbound Events and emails'))

// ---- order actions (ticket #17) -------------------------------------------

const ActionResult = Schema.Struct({
  detail: OrderDetail,
  outcome: Schema.String,
})

const showAction = (r: typeof ActionResult.Type) =>
  print(`Order ${r.detail.order.id}  ${r.detail.order.state}`, `  ${r.outcome}`)

const recipientOptions = {
  name: Options.text('name'),
  address1: Options.text('address1'),
  address2: Options.text('address2').pipe(Options.optional),
  city: Options.text('city'),
  state: Options.text('state').pipe(
    Options.withDescription('State/province code (US, CA, AU)'),
    Options.optional,
  ),
  zip: Options.text('zip').pipe(Options.optional),
  country: Options.text('country').pipe(Options.withDescription('ISO 3166-1 alpha-2')),
  email: Options.text('email'),
  phone: Options.text('phone').pipe(Options.optional),
}

type RecipientFlags = {
  [K in keyof typeof recipientOptions]: (typeof recipientOptions)[K] extends Options.Options<
    infer A
  >
    ? A
    : never
}

const toRecipient = (r: RecipientFlags) => ({
  name: r.name,
  address1: r.address1,
  ...(Option.isSome(r.address2) ? { address2: r.address2.value } : {}),
  city: r.city,
  ...(Option.isSome(r.state) ? { state: r.state.value.toUpperCase() } : {}),
  ...(Option.isSome(r.zip) ? { zip: r.zip.value } : {}),
  country: r.country.toUpperCase(),
  email: r.email,
  ...(Option.isSome(r.phone) ? { phone: r.phone.value } : {}),
})

const ordersCreate = Command.make(
  'create',
  {
    engine: Options.text('engine'),
    design: Options.text('design').pipe(Options.withDescription('Design ID at the Engine')),
    offer: Options.text('offer'),
    variant: Options.text('variant'),
    paidOutside: Options.boolean('paid-outside').pipe(
      Options.withDescription('The Customer paid outside Stripe (reprint, offline sale); required'),
    ),
    sendEmail: Options.boolean('send-email').pipe(
      Options.withDescription('Send the Customer the confirmation email'),
    ),
    ...recipientOptions,
  },
  (flags) =>
    Effect.gen(function* () {
      if (!flags.paidOutside) {
        return yield* failWith('v1 creates orders paid outside Stripe only: pass --paid-outside')
      }
      const r = yield* api('POST', '/api/operator/orders', ActionResult, {
        engine: flags.engine,
        designId: flags.design,
        offer: flags.offer,
        variant: flags.variant,
        recipient: toRecipient(flags),
        paidOutside: true,
        email: flags.sendEmail,
      })
      yield* showAction(r)
    }),
).pipe(Command.withDescription('Create an Order paid outside the PSP and submit it'))

const ordersResubmit = Command.make('resubmit', { orderId }, ({ orderId }) =>
  api('POST', `/api/operator/orders/${encodeURIComponent(orderId)}/resubmit`, ActionResult).pipe(
    Effect.flatMap(showAction),
  ),
).pipe(Command.withDescription('Submit again from submit_failed, or re-confirm an on_hold order'))

const ordersFixAddress = Command.make('fix-address', { orderId, ...recipientOptions }, (flags) =>
  api('POST', `/api/operator/orders/${encodeURIComponent(flags.orderId)}/address`, ActionResult, {
    recipient: toRecipient(flags),
  }).pipe(Effect.flatMap(showAction)),
).pipe(Command.withDescription('Replace the Recipient (same country) and resubmit'))

const ordersCancel = Command.make('cancel', { orderId }, ({ orderId }) =>
  api('POST', `/api/operator/orders/${encodeURIComponent(orderId)}/cancel`, ActionResult).pipe(
    Effect.flatMap(showAction),
  ),
).pipe(Command.withDescription('Cancel at the provider when possible and record it; never refunds'))

const olderThan = Options.integer('older-than').pipe(
  Options.withDescription('Days since the Order last changed'),
)

const ordersPurge = Command.make('purge', { olderThan }, ({ olderThan }) =>
  api('POST', '/api/operator/orders/purge', Schema.Struct({ purged: Schema.Number }), {
    olderThanDays: olderThan,
  }).pipe(
    Effect.flatMap((r) =>
      print(
        `Purged personal data from ${r.purged} Order(s) finished more than ${olderThan} days ago.`,
      ),
    ),
  ),
).pipe(Command.withDescription('Strip Recipient and consent details from old terminal Orders'))

const orders = Command.make('orders').pipe(
  Command.withDescription('Browse and act on Orders'),
  Command.withSubcommands([
    ordersList,
    ordersShow,
    ordersCreate,
    ordersResubmit,
    ordersFixAddress,
    ordersCancel,
    ordersPurge,
  ]),
)

// ---- reconcile ------------------------------------------------------------

const Report = Schema.Struct({
  trigger: Schema.String,
  dryRun: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
  steps: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      checked: Schema.Number,
      repaired: Schema.Number,
      notes: Schema.Array(Schema.String),
    }),
  }),
  alarms: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      orderId: Schema.optional(Schema.String),
      message: Schema.String,
    }),
  ),
})

const dryRun = Options.boolean('dry-run').pipe(
  Options.withDescription('Report what a run would repair without changing anything'),
)

const reconcile = Command.make('reconcile', { dryRun }, ({ dryRun }) =>
  Effect.gen(function* () {
    const r = yield* api('POST', `/api/operator/reconcile${dryRun ? '?dryRun=true' : ''}`, Report)
    yield* print(
      `Reconciliation${r.dryRun ? ' (dry run)' : ''} took ${r.finishedAt - r.startedAt} ms`,
    )
    for (const [name, s] of Object.entries(r.steps)) {
      yield* print(
        `  ${name}: ${s.checked} checked, ${s.repaired} repaired`,
        ...s.notes.map((n) => `      ${n}`),
      )
    }
    if (r.alarms.length === 0) return yield* print('No alarms.')
    yield* print(
      `${r.alarms.length} alarm(s):`,
      ...r.alarms.map((a) => `  [${a.kind}] ${a.orderId ? `${a.orderId}: ` : ''}${a.message}`),
    )
  }),
).pipe(Command.withDescription('Run Reconciliation now'))

// ---- printfile ------------------------------------------------------------

/**
 * The instance's answer, decoded leniently in both directions. A field the
 * instance may not have is optional, so a newer CLI reads an older instance —
 * and `deviations` missing is itself a fact worth printing, distinct from "no
 * Deviations found". A `reason` or `code` is read as text rather than as the
 * vocabulary this CLI shipped with, so an older CLI prints a refusal added
 * after it was built instead of refusing the whole answer.
 */
const PrintfileResult = Schema.Struct({
  spec: Spec,
  specHash: Schema.String,
  file: Schema.Struct({
    status: Schema.Number,
    contentType: Schema.String,
    bytes: Schema.optional(Schema.Number),
    header: Schema.optional(ImageHeader),
    invalid: Schema.optional(
      Schema.Array(Schema.Struct({ reason: Schema.String, message: Schema.String })),
    ),
    deviations: Schema.optional(
      Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String })),
    ),
  }),
  // An instance that predates the Inspection carries its verdict beside the
  // file rather than its refusals inside it. Both are read; neither is assumed.
  ok: Schema.optional(Schema.Boolean),
  problems: Schema.optional(Schema.Array(Schema.String)),
})

const UNREADABLE_VERDICT = {
  reason: 'unknown',
  message:
    'this instance answered in a shape this CLI cannot read, so what Validation refuses is unknown; upgrade the instance, or the CLI',
}

const REFUSED_WITHOUT_REASON = {
  reason: 'unknown',
  message: 'this instance refused the file without saying why',
}

/**
 * The refusals, from whichever shape the instance speaks. A pre-Inspection
 * instance answers with `ok` and `problems`, its refusals bare strings with no
 * vocabulary behind them; they become refusals with an `unknown` reason, which
 * is what they were.
 *
 * The one thing this may never do is read silence as a clean file. An answer
 * carrying neither shape is not "nothing Validation would refuse", it is an
 * answer we cannot read, and it fails closed with that said out loud.
 */
const refusalsOf = (r: (typeof PrintfileResult)['Type']) => {
  if (r.file.invalid) return r.file.invalid
  if (r.ok === undefined && r.problems === undefined) return [UNREADABLE_VERDICT]
  const legacy = (r.problems ?? []).map((message) => ({ reason: 'unknown', message }))
  if (legacy.length > 0) return legacy
  return r.ok === false ? [REFUSED_WITHOUT_REASON] : []
}

/**
 * The size of a file the Operator is looking at, not an exact count: this
 * command answers "is that the file I meant?", where `4.2 MB` reads and
 * `4404019 bytes` does not. Preflight prints the exact count, because a
 * developer chasing the 64 KiB window needs it.
 */
const humanBytes = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.round(bytes / 100) / 10} KB`
    : `${Math.round(bytes / 100_000) / 10} MB`

const fileUrl = Args.text({ name: 'url' })
const offer = Options.text('offer')
const variant = Options.text('variant')

const printfileCheck = Command.make(
  'check',
  { fileUrl, offer, variant, strict },
  ({ fileUrl, offer, variant, strict }) =>
    Effect.gen(function* () {
      const r = yield* api('POST', '/api/operator/printfile/check', PrintfileResult, {
        url: fileUrl,
        offer,
        variant,
      })
      const file = r.file
      const size = file.bytes === undefined ? '' : `, ${humanBytes(file.bytes)}`
      // One file's Inspection, in Preflight's own block: an envelope line for
      // what the host answered, the header, then the refusals and Deviations.
      const invalid = refusalsOf(r)
      const inspection = { invalid, deviations: file.deviations ?? [] }
      yield* print(
        `Spec ${offer}/${variant}: ${specSummary(r.spec, r.specHash)}`,
        `File: HTTP ${file.status}, ${file.contentType || 'no content type'}${size}`,
        ...(file.header ? [`  ${describeHeader(file.header)}`] : []),
        ...formatInspection(inspection),
        // An instance that predates Deviations reported none because it looked
        // for none: that is not the same fact as a file that has none.
        ...(file.deviations ? [] : ['  · this instance does not report Deviations']),
      )
      // The shared exit rule, plus the one case an Inspection cannot express:
      // `--strict` cannot pass on an answer that never looked for Deviations.
      if (!inspectionFails(inspection, strict)) {
        if (!strict || file.deviations) return
        return yield* failWith('--strict: this instance does not report Deviations')
      }
      return yield* failWith(
        invalid.length > 0
          ? `${invalid.length} problem(s)`
          : `--strict: ${inspection.deviations.length} Deviation(s)`,
      )
    }),
).pipe(
  Command.withDescription('Check any image URL against the Printfile Spec of an Offer variant'),
)

const printfile = Command.make('printfile').pipe(
  Command.withDescription('Printfile tools'),
  Command.withSubcommands([printfileCheck]),
)

// ---- offers (public, for Engine developers) ---------------------------------

const asJson = Options.boolean('json').pipe(
  Options.withDescription('Print the grouped structure as JSON'),
)

const aspectNote = (a: { min: number; max: number } | null) =>
  a === null ? '' : a.min === a.max ? `, aspect ${a.min}` : `, aspect ${a.min}–${a.max}`

const offers = Command.make('offers', { json: asJson }, ({ json }) =>
  Effect.gen(function* () {
    const c = yield* publicGet('/api/offers', CatalogResponse)
    // Every size of a tee has the same Placement, so one Spec: group by Spec Hash.
    const grouped = c.offers.map(({ variants, ...offer }) => ({
      ...offer,
      specs: groupBySpec(variants),
    }))
    if (json) {
      return yield* print(
        JSON.stringify(
          { protocolVersion: c.protocolVersion, currency: c.currency, offers: grouped },
          null,
          2,
        ),
      )
    }
    for (const o of grouped) {
      yield* print(
        `${o.slug}  ${o.name} — ${o.placement} / ${o.technique}${aspectNote(o.aspect)}, ${money(o.retailPrice.amount, o.retailPrice.currency)}`,
      )
      for (const g of o.specs) {
        yield* print(
          `  ${specSummary(g.spec, g.specHash)}  ${g.variants.map((v) => v.key).join(', ')}`,
        )
      }
    }
  }),
).pipe(
  Command.withDescription(
    'The Offers this instance sells, with one line per distinct Printfile Spec (public, no token)',
  ),
)

// ---- root -----------------------------------------------------------------

const root = Command.make('pressline', { url, token }).pipe(
  Command.withDescription(
    'Operate a Pressline instance through its operator API, and check an Engine against it',
  ),
  Command.withSubcommands([
    doctor,
    catalog,
    webhooks,
    orders,
    reconcile,
    printfile,
    offers,
    engine,
  ]),
)

/** Read from the manifest rather than restated here, so a release cannot leave
 * the two disagreeing. Resolves the same from `src` and from `dist`. */
export const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version

/**
 * The CLI as a function of argv (including the two leading entries node
 * strips). Needs `HttpClient`, `Output` and the CLI environment.
 */
export const cli = Command.run(
  root.pipe(Command.provideEffect(Instance, ({ url, token }) => Effect.succeed({ url, token }))),
  { name: 'pressline', version: VERSION },
)
