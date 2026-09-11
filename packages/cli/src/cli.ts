import { Args, Command, Options } from '@effect/cli';
import { Config, Effect, Option, Schema } from 'effect';
import { api, CliError, Instance } from './client.js';
import { print } from './output.js';

/**
 * `pressline` — the Operator's command line for one instance. Every command
 * is a thin client of the operator API; nothing here reaches the database or
 * the providers directly (ADR-0014).
 */
const url = Options.text('url').pipe(
  Options.withDescription('Base URL of the Pressline instance'),
  Options.withFallbackConfig(Config.string('PRESSLINE_URL')),
);
const token = Options.redacted('token').pipe(
  Options.withDescription('Operator token'),
  Options.withFallbackConfig(Config.redacted('PRESSLINE_TOKEN')),
);

const mark = (ok: boolean) => (ok ? '✓' : '✗');

/** Fail the command (exit code 1) with one line. */
const failWith = (message: string) => Effect.fail(new CliError({ message }));

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
  secrets: Schema.Record({ key: Schema.String, value: Schema.Boolean }),
  schema: Schema.Struct({ version: Schema.Number, latest: Schema.Number }),
});

const REQUIRED_SECRETS = [
  'printful',
  'stripe',
  'stripeWebhook',
  'printfulWebhook',
  'sessionSecret',
];

const doctor = Command.make('doctor', {}, () =>
  Effect.gen(function* () {
    const h = yield* api('GET', '/api/operator/health', Health);
    const problems: string[] = [];
    const lines: string[] = [
      `${h.config.name} (${h.config.currency}, ${h.config.offers} offers, demo ${h.config.demo ? 'on' : 'off'}, mailer ${h.config.mailer})`,
      `${mark(h.schema.version === h.schema.latest)} schema v${h.schema.version} of ${h.schema.latest}`,
    ];
    for (const name of REQUIRED_SECRETS) {
      const present = h.secrets[name] ?? false;
      lines.push(`${mark(present)} secret ${name}`);
      if (!present) problems.push(`secret ${name} is not set`);
    }
    for (const e of h.engines) {
      lines.push(`${mark(e.enabled)} engine ${e.slug}${e.reason ? `: ${e.reason}` : ''}`);
      if (!e.enabled) problems.push(`engine ${e.slug} is disabled`);
    }
    for (const [name, w] of Object.entries(h.webhooks)) {
      lines.push(
        `${mark(w.configured)} ${name} webhook ${w.configured ? w.url : `not registered${w.detail ? ` (${w.detail})` : ''}`}`,
      );
      if (!w.configured)
        problems.push(`${name} webhook is not registered (run: pressline webhooks register)`);
    }
    yield* print(...lines);
    if (problems.length > 0)
      return yield* failWith(`${problems.length} problem(s): ${problems.join('; ')}`);
  }),
).pipe(
  Command.withDescription('Check the instance: config, secrets, Engines, providers, webhooks'),
);

// ---- catalogue ------------------------------------------------------------

const Spec = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  dpi: Schema.Number,
  formats: Schema.Array(Schema.String),
  alpha: Schema.String,
});

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
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** An Offer the Operator can paste into `pressline.config.ts`, with every variant keyed by colour and size. */
const offerSnippet = (p: (typeof SearchResult.Type)['products'][number]) => {
  const method = p.placements[0];
  const variants = p.variants
    .map((v) => {
      const key = slugify([v.color, v.size].filter(Boolean).join(' ') || v.name);
      const fields = [
        `catalogVariantId: ${v.id}`,
        `label: ${JSON.stringify([v.color, v.size].filter(Boolean).join(' / ') || v.name)}`,
        ...(v.color ? [`color: ${JSON.stringify(v.color)}`] : []),
        ...(v.size ? [`size: ${JSON.stringify(v.size)}`] : []),
      ];
      return `      '${key}': { ${fields.join(', ')} },`;
    })
    .join('\n');
  return [
    `  {`,
    `    slug: '${slugify(p.name)}',`,
    `    name: ${JSON.stringify(p.name)},`,
    `    catalogProductId: ${p.id},`,
    `    placement: '${method?.placement ?? 'front'}',`,
    `    technique: '${method?.technique ?? 'dtg'}',`,
    `    retailPrice: 0, // minor units, set your price`,
    `    variants: {`,
    variants,
    `    },`,
    `  },`,
  ].join('\n');
};

const searchText = Args.text({ name: 'text' }).pipe(
  Args.withDescription('Words of the product name'),
);

const catalogueSearch = Command.make('search', { text: searchText }, ({ text }) =>
  Effect.gen(function* () {
    const { products } = yield* api(
      'GET',
      `/api/operator/catalogue/search?q=${encodeURIComponent(text)}`,
      SearchResult,
    );
    if (products.length === 0) return yield* print(`No products match "${text}".`);
    for (const p of products) {
      yield* print(`${p.id}  ${p.name}`);
      for (const m of p.placements) {
        const spec = m.spec
          ? `${m.spec.width}×${m.spec.height}px @ ${m.spec.dpi} dpi, ${m.spec.formats.join('/')}, alpha ${m.spec.alpha}`
          : 'no print area known';
        yield* print(`    ${m.placement} / ${m.technique}: ${spec}`);
      }
      for (const v of p.variants) {
        yield* print(`    variant ${v.id}  ${v.name}`);
      }
      yield* print('  Offer snippet for pressline.config.ts:', offerSnippet(p), '');
    }
  }),
).pipe(
  Command.withDescription('Find provider products by name; prints Specs and an Offer snippet'),
);

const CheckResult = Schema.Struct({
  offers: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      ok: Schema.Boolean,
      variants: Schema.Number,
      message: Schema.optional(Schema.String),
    }),
  ),
});

const catalogueCheck = Command.make('check', {}, () =>
  Effect.gen(function* () {
    const { offers } = yield* api('GET', '/api/operator/catalogue/check', CheckResult);
    for (const o of offers) {
      yield* print(`${mark(o.ok)} ${o.slug}: ${o.ok ? `${o.variants} variants` : o.message}`);
    }
    const bad = offers.filter((o) => !o.ok);
    if (bad.length > 0)
      return yield* failWith(`${bad.length} of ${offers.length} Offers do not resolve`);
    yield* print(`All ${offers.length} Offers resolve.`);
  }),
).pipe(Command.withDescription('Verify every configured Offer resolves at the provider'));

const catalogue = Command.make('catalogue').pipe(
  Command.withDescription('Provider catalogue tools'),
  Command.withSubcommands([catalogueSearch, catalogueCheck]),
);

// ---- webhooks -------------------------------------------------------------

const Registration = Schema.Struct({
  status: Schema.Literal('created', 'verified'),
  url: Schema.String,
  secret: Schema.optional(Schema.String),
  publicKey: Schema.optional(Schema.String),
});
const RegisterResult = Schema.Struct({ stripe: Registration, printful: Registration });

const publicUrl = Options.text('public-url').pipe(
  Options.withDescription('Public https origin of the instance (defaults to checkout.publicUrl)'),
  Options.optional,
);

const webhooksRegister = Command.make('register', { publicUrl }, ({ publicUrl }) =>
  Effect.gen(function* () {
    const r = yield* api(
      'POST',
      '/api/operator/webhooks/register',
      RegisterResult,
      Option.isSome(publicUrl) ? { publicUrl: publicUrl.value } : {},
    );
    yield* print(`✓ Stripe ${r.stripe.status} ${r.stripe.url}`);
    if (r.stripe.secret) yield* print(`  set STRIPE_WEBHOOK_SECRET=${r.stripe.secret}`);
    yield* print(`✓ Printful ${r.printful.status} ${r.printful.url}`);
    if (r.printful.secret) yield* print(`  set PRINTFUL_WEBHOOK_SECRET=${r.printful.secret}`);
    if (r.printful.publicKey)
      yield* print(`  set PRINTFUL_WEBHOOK_PUBLIC_KEY=${r.printful.publicKey}`);
    if (r.stripe.secret || r.printful.secret) {
      yield* print('Secrets are shown once: store them in the deployment now, then redeploy.');
    }
  }),
).pipe(Command.withDescription('Create or verify the Stripe and Printful webhook endpoints'));

const webhooks = Command.make('webhooks').pipe(
  Command.withDescription('Webhook endpoints at the providers'),
  Command.withSubcommands([webhooksRegister]),
);

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
});
const OrderList = Schema.Struct({
  orders: Schema.Array(OrderRow),
  nextCursor: Schema.optional(Schema.String),
});
const OrderDetail = Schema.Struct({
  order: OrderRow.pipe(
    Schema.extend(
      Schema.Struct({
        recipient: Schema.optional(
          Schema.Struct({ name: Schema.String, country: Schema.String, email: Schema.String }),
        ),
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
});

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const money = (amount: number, currency: string) => {
  const f = new Intl.NumberFormat('en', { style: 'currency', currency });
  return f.format(amount / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2));
};

const state = Options.text('state').pipe(
  Options.withDescription('Only Orders in this state'),
  Options.optional,
);
const limit = Options.integer('limit').pipe(Options.withDefault(50));

const ordersList = Command.make('list', { state, limit }, ({ state, limit }) =>
  Effect.gen(function* () {
    const q = new URLSearchParams({ limit: String(limit) });
    if (Option.isSome(state)) q.set('state', state.value);
    const { orders } = yield* api('GET', `/api/operator/orders?${q}`, OrderList);
    if (orders.length === 0) return yield* print('No orders.');
    for (const o of orders) {
      yield* print(
        `${o.id}  ${iso(o.updatedAt)}  ${o.state.padEnd(14)} ${o.offer}/${o.variant} → ${o.country}  ${money(o.amountTotal ?? o.retail + o.shipping, o.currency)}`,
      );
    }
  }),
).pipe(Command.withDescription('List Orders, newest first'));

const orderId = Args.text({ name: 'id' });

const ordersShow = Command.make('show', { orderId }, ({ orderId }) =>
  Effect.gen(function* () {
    const d = yield* api('GET', `/api/operator/orders/${encodeURIComponent(orderId)}`, OrderDetail);
    const o = d.order;
    yield* print(
      `Order ${o.id}  ${o.state}`,
      `  ${o.engine}/${o.designId}  ${o.offer}/${o.variant}  ${money(o.amountTotal ?? o.retail + o.shipping, o.currency)} → ${o.country}`,
      ...(o.recipient ? [`  ${o.recipient.name} <${o.recipient.email}>`] : []),
      ...(o.providerOrderId ? [`  provider order ${o.providerOrderId}`] : []),
      'Transitions:',
      ...d.transitions.map(
        (t) =>
          `  ${iso(t.at)}  ${t.from ?? '—'} → ${t.to}  (${t.cause}${t.causeRef ? ` ${t.causeRef}` : ''})${t.note ? `  ${t.note}` : ''}`,
      ),
    );
    if (d.inboundEvents.length > 0) {
      yield* print(
        'Inbound events:',
        ...d.inboundEvents.map(
          (e) => `  ${e.provider} ${e.eventType} ${e.eventId}: ${e.outcome ?? 'pending'}`,
        ),
      );
    }
    if (d.emails.length > 0) {
      yield* print(
        'Emails:',
        ...d.emails.map(
          (e) =>
            `  ${e.kind}: ${e.sentAt ? `sent ${iso(e.sentAt)}` : `not sent (${e.attempts} attempts)`}`,
        ),
      );
    }
  }),
).pipe(Command.withDescription('Show one Order with its Transitions, Inbound Events and emails'));

const orders = Command.make('orders').pipe(
  Command.withDescription('Browse Orders'),
  Command.withSubcommands([ordersList, ordersShow]),
);

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
});

const dryRun = Options.boolean('dry-run').pipe(
  Options.withDescription('Report what a run would repair without changing anything'),
);

const reconcile = Command.make('reconcile', { dryRun }, ({ dryRun }) =>
  Effect.gen(function* () {
    const r = yield* api('POST', `/api/operator/reconcile${dryRun ? '?dryRun=true' : ''}`, Report);
    yield* print(
      `Reconciliation${r.dryRun ? ' (dry run)' : ''} took ${r.finishedAt - r.startedAt} ms`,
    );
    for (const [name, s] of Object.entries(r.steps)) {
      yield* print(
        `  ${name}: ${s.checked} checked, ${s.repaired} repaired`,
        ...s.notes.map((n) => `      ${n}`),
      );
    }
    if (r.alarms.length === 0) return yield* print('No alarms.');
    yield* print(
      `${r.alarms.length} alarm(s):`,
      ...r.alarms.map((a) => `  [${a.kind}] ${a.orderId ? `${a.orderId}: ` : ''}${a.message}`),
    );
  }),
).pipe(Command.withDescription('Run Reconciliation now'));

// ---- printfile ------------------------------------------------------------

const PrintfileResult = Schema.Struct({
  spec: Spec,
  specHash: Schema.String,
  file: Schema.Struct({
    status: Schema.Number,
    contentType: Schema.String,
    bytes: Schema.optional(Schema.Number),
    header: Schema.optional(
      Schema.Struct({
        format: Schema.String,
        width: Schema.Number,
        height: Schema.Number,
        hasAlpha: Schema.Boolean,
      }),
    ),
  }),
  ok: Schema.Boolean,
  problems: Schema.Array(Schema.String),
});

const fileUrl = Args.text({ name: 'url' });
const offer = Options.text('offer');
const variant = Options.text('variant');

const printfileCheck = Command.make(
  'check',
  { fileUrl, offer, variant },
  ({ fileUrl, offer, variant }) =>
    Effect.gen(function* () {
      const r = yield* api('POST', '/api/operator/printfile/check', PrintfileResult, {
        url: fileUrl,
        offer,
        variant,
      });
      const h = r.file.header;
      yield* print(
        `Spec ${offer}/${variant}: ${r.spec.width}×${r.spec.height}px @ ${r.spec.dpi} dpi, ${r.spec.formats.join('/')}, alpha ${r.spec.alpha} (hash ${r.specHash.slice(0, 12)}…)`,
        `File: HTTP ${r.file.status}, ${r.file.contentType || 'no content type'}${r.file.bytes ? `, ${r.file.bytes} bytes` : ''}${h ? `, ${h.format} ${h.width}×${h.height}${h.hasAlpha ? ' with alpha' : ''}` : ''}`,
      );
      if (r.ok) return yield* print('✓ The file satisfies the Spec.');
      yield* print(...r.problems.map((p) => `✗ ${p}`));
      return yield* failWith(`${r.problems.length} problem(s)`);
    }),
).pipe(
  Command.withDescription('Check any image URL against the Printfile Spec of an Offer variant'),
);

const printfile = Command.make('printfile').pipe(
  Command.withDescription('Printfile tools'),
  Command.withSubcommands([printfileCheck]),
);

// ---- root -----------------------------------------------------------------

const root = Command.make('pressline', { url, token }).pipe(
  Command.withDescription('Operate a Pressline instance through its operator API'),
  Command.withSubcommands([doctor, catalogue, webhooks, orders, reconcile, printfile]),
);

export const VERSION = '0.1.0';

/**
 * The CLI as a function of argv (including the two leading entries node
 * strips). Needs `HttpClient`, `Output` and the CLI environment.
 */
export const cli = Command.run(
  root.pipe(Command.provideEffect(Instance, ({ url, token }) => Effect.succeed({ url, token }))),
  { name: 'pressline', version: VERSION },
);
