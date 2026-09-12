import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform';
import {
  CatalogOffer,
  CatalogResponse,
  DesignNotFound,
  DesignResponse,
  Slug,
} from '@pressline/contract';
import { Schema } from 'effect';
import { EngineUnavailable } from '../design/design';
import { EngineStatus } from '../design/engines';
import { CheckoutRequest, CheckoutStarted, CheckoutUnavailable } from '../checkout/checkout';
import { OrderNotFound } from '../orders/orders';
import { PublicOrder } from '../orders/public';
import { PrintfileUnavailable, StoredPrintfile } from '../printfile/ensure';
import { OperatorAuth, Unauthorized } from '../operator/auth';
import { InstanceHealth, OrderDetail, OrderList, OrderListQuery } from '../operator/read';
import { ReconciliationReport } from '../reconciliation/run';
import {
  ActionRefused,
  ActionResult,
  CreateOrderRequest,
  PurgeRequest,
  PurgeResult,
} from '../operator/actions';
import { Recipient } from '../orders/orders';
import {
  CatalogCheckResult,
  CatalogSearchQuery,
  CatalogSearchResult,
  PrintfileCheckRequest,
  PrintfileCheckResult,
  ToolError,
  WebhookRegisterRequest,
  WebhookRegisterResult,
} from '../operator/tools';
import { ProviderWebhookRejected } from '../services/fulfillment-provider';
import { WebhookRejected } from '../services/psp';
import { ProviderWebhookProcessingFailed } from '../webhooks/printful';
import { WebhookAck, WebhookProcessingFailed } from '../webhooks/stripe';
import {
  Quote,
  QuoteInconsistent,
  QuoteNotFound,
  QuoteRequest,
  QuoteUnavailable,
} from '../quote/quote';

/**
 * The Effect HttpApi: JSON API, operator API, Engine-facing endpoints and
 * webhooks (ADR-0012). Groups are added per ticket. SvelteKit forwards
 * `/api/*` and `/webhooks/*` here and renders everything else itself.
 */
export const HealthResponse = Schema.Struct({
  ok: Schema.Literal(true),
  protocolVersion: Schema.String,
  schemaVersion: Schema.Number,
  demo: Schema.Boolean,
  config: Schema.Struct({
    name: Schema.String,
    currency: Schema.String,
    offers: Schema.Number,
  }),
  engines: Schema.Array(EngineStatus),
});
export type HealthResponse = typeof HealthResponse.Type;

export const HealthGroup = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('health', '/api/health').addSuccess(HealthResponse),
);

/** The Catalog could not be resolved: misconfiguration or the provider is down. */
export class CatalogUnavailable extends Schema.TaggedError<CatalogUnavailable>()(
  'CatalogUnavailable',
  { message: Schema.String, offer: Schema.optional(Schema.String) },
) {}

export const CatalogGroup = HttpApiGroup.make('catalog').add(
  HttpApiEndpoint.get('offers', '/api/offers')
    .addSuccess(CatalogResponse)
    .addError(CatalogUnavailable, { status: 503 }),
);

/** The Engine could not be reached for this request. */
export class EngineError extends Schema.TaggedError<EngineError>()('EngineError', {
  engine: Schema.String,
  message: Schema.String,
}) {}

/** What the Storefront needs to show a Design (ticket #5). */
/** Operator branding and legal wording the Storefront shows (ADR-0010, ADR-0014). */
export const StorefrontInfo = Schema.Struct({
  name: Schema.String,
  logoUrl: Schema.optional(Schema.String),
  accent: Schema.String,
  accentText: Schema.String,
  /** Demo Mode (CONTEXT.md): set, with the PSP's test card, when no money or goods move. */
  demo: Schema.optional(Schema.Struct({ testCard: Schema.String })),
  withdrawalNotice: Schema.String,
  termsUrl: Schema.optional(Schema.String),
  privacyUrl: Schema.optional(Schema.String),
  contactEmail: Schema.optional(Schema.String),
});

export const DesignPage = Schema.Struct({
  engine: Schema.String,
  design: DesignResponse,
  /** Eligible Offers; empty when the Design is not sellable. */
  offers: Schema.Array(CatalogOffer),
  currency: Schema.String,
  storefront: StorefrontInfo,
});
export type DesignPage = typeof DesignPage.Type;

const DesignPath = Schema.Struct({ engine: Slug, designId: Schema.String });

export const DesignsGroup = HttpApiGroup.make('designs').add(
  HttpApiEndpoint.get('design', '/api/designs/:engine/:designId')
    .setPath(DesignPath)
    .addSuccess(DesignPage)
    .addError(DesignNotFound, { status: 404 })
    .addError(EngineUnavailable, { status: 503 })
    .addError(EngineError, { status: 502 })
    .addError(CatalogUnavailable, { status: 503 }),
);

/** Ensure-Printfile answers (ticket #6, ADR-0005). */
export const PrintfileReadyState = Schema.Struct({
  status: Schema.Literal('ready'),
  printfile: StoredPrintfile,
});
export const PrintfilePreparingState = Schema.Struct({
  status: Schema.Literal('preparing'),
  retryAfterMs: Schema.Int,
});
export const PrintfileSelection = Schema.Struct({ offer: Slug, variant: Slug });

export const PrintfilesGroup = HttpApiGroup.make('printfiles')
  .add(
    // Ask the Engine, waiting up to the configured bound for a rendering one.
    HttpApiEndpoint.post('ensure', '/api/designs/:engine/:designId/printfile')
      .setPath(DesignPath)
      .setPayload(PrintfileSelection)
      .addSuccess(PrintfileReadyState, { status: 200 })
      .addSuccess(PrintfilePreparingState, { status: 202 })
      .addError(PrintfileUnavailable, { status: 422 })
      .addError(DesignNotFound, { status: 404 })
      .addError(EngineUnavailable, { status: 503 })
      .addError(EngineError, { status: 502 })
      .addError(CatalogUnavailable, { status: 503 }),
  )
  .add(
    // Same answer without waiting; what the Storefront's preparing page polls.
    HttpApiEndpoint.get('status', '/api/designs/:engine/:designId/printfile')
      .setPath(DesignPath)
      .setUrlParams(PrintfileSelection)
      .addSuccess(PrintfileReadyState, { status: 200 })
      .addSuccess(PrintfilePreparingState, { status: 202 })
      .addError(PrintfileUnavailable, { status: 422 })
      .addError(DesignNotFound, { status: 404 })
      .addError(EngineUnavailable, { status: 503 })
      .addError(EngineError, { status: 502 })
      .addError(CatalogUnavailable, { status: 503 }),
  );

/** Quotes (ticket #7, ADR-0010). */
export const QuotesGroup = HttpApiGroup.make('quotes')
  .add(
    HttpApiEndpoint.get('quote', '/api/quote')
      .setUrlParams(QuoteRequest)
      .addSuccess(Quote)
      .addError(QuoteUnavailable, { status: 422 })
      .addError(QuoteInconsistent, { status: 503 })
      .addError(DesignNotFound, { status: 404 })
      .addError(EngineUnavailable, { status: 503 })
      .addError(EngineError, { status: 502 })
      .addError(CatalogUnavailable, { status: 503 }),
  )
  .add(
    HttpApiEndpoint.get('quoteById', '/api/quotes/:id')
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(Quote)
      .addError(QuoteNotFound, { status: 404 }),
  );

/** The PSP could not be reached or refused the session. */
export class PspUnavailable extends Schema.TaggedError<PspUnavailable>()('PspUnavailable', {
  message: Schema.String,
}) {}

/** Checkout and public order status (tickets #8, #13). */
export const OrdersGroup = HttpApiGroup.make('orders')
  .add(
    HttpApiEndpoint.post('checkout', '/api/checkout')
      .setPayload(CheckoutRequest)
      .addSuccess(CheckoutStarted)
      .addError(CheckoutUnavailable, { status: 422 })
      .addError(QuoteNotFound, { status: 404 })
      .addError(DesignNotFound, { status: 404 })
      .addError(PspUnavailable, { status: 502 })
      .addError(EngineUnavailable, { status: 503 })
      .addError(EngineError, { status: 502 })
      .addError(CatalogUnavailable, { status: 503 }),
  )
  .add(
    HttpApiEndpoint.get('publicOrder', '/api/orders/:id')
      .setPath(Schema.Struct({ id: Schema.String }))
      .setUrlParams(Schema.Struct({ t: Schema.String }))
      .addSuccess(PublicOrder)
      .addError(OrderNotFound, { status: 404 }),
  );

/** Provider webhooks (ADR-0007): raw body in, signature verified by the adapter. */
export const WebhooksGroup = HttpApiGroup.make('webhooks')
  .add(
    HttpApiEndpoint.post('stripe', '/webhooks/stripe')
      // No payload schema: the signature covers the exact bytes, so the handler reads the raw body itself.
      .setHeaders(Schema.Struct({ 'stripe-signature': Schema.optional(Schema.String) }))
      .addSuccess(WebhookAck)
      .addError(WebhookRejected, { status: 400 })
      .addError(WebhookProcessingFailed, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post('printful', '/webhooks/printful')
      .setHeaders(
        Schema.Struct({
          'x-pf-webhook-signature': Schema.optional(Schema.String),
          'x-pf-webhook-public-key': Schema.optional(Schema.String),
        }),
      )
      .addSuccess(WebhookAck)
      .addError(ProviderWebhookRejected, { status: 400 })
      .addError(ProviderWebhookProcessingFailed, { status: 500 }),
  );

/** A session for the Operator View, issued against the bearer token. */
export const OperatorSession = Schema.Struct({
  /** Cookie value (`<expiresAt>.<hmac>`); the browser stores it HttpOnly. */
  cookie: Schema.String,
  expiresAt: Schema.Int,
});

/** Operator read API (ticket #14, ADR-0014): bearer token or session cookie; read-only. */
export const OperatorGroup = HttpApiGroup.make('operator')
  .add(
    HttpApiEndpoint.post('session', '/api/operator/session')
      .addSuccess(OperatorSession)
      .addError(Unauthorized, { status: 401 }),
  )
  .add(HttpApiEndpoint.get('health', '/api/operator/health').addSuccess(InstanceHealth))
  .add(
    HttpApiEndpoint.get('orders', '/api/operator/orders')
      .setUrlParams(OrderListQuery)
      .addSuccess(OrderList),
  )
  .add(
    HttpApiEndpoint.get('order', '/api/operator/orders/:id')
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(OrderDetail)
      .addError(OrderNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post('createOrder', '/api/operator/orders')
      .setPayload(CreateOrderRequest)
      .addSuccess(ActionResult)
      .addError(ActionRefused, { status: 422 })
      .addError(OrderNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post('purgeOrders', '/api/operator/orders/purge')
      .setPayload(PurgeRequest)
      .addSuccess(PurgeResult),
  )
  .add(
    HttpApiEndpoint.post('resubmitOrder', '/api/operator/orders/:id/resubmit')
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(ActionResult)
      .addError(ActionRefused, { status: 422 })
      .addError(OrderNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post('fixOrderAddress', '/api/operator/orders/:id/address')
      .setPath(Schema.Struct({ id: Schema.String }))
      .setPayload(Schema.Struct({ recipient: Recipient }))
      .addSuccess(ActionResult)
      .addError(ActionRefused, { status: 422 })
      .addError(OrderNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post('cancelOrder', '/api/operator/orders/:id/cancel')
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(ActionResult)
      .addError(ActionRefused, { status: 422 })
      .addError(OrderNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post('reconcile', '/api/operator/reconcile')
      .setUrlParams(Schema.Struct({ dryRun: Schema.optional(Schema.Literal('true', 'false')) }))
      .addSuccess(ReconciliationReport),
  )
  .add(
    HttpApiEndpoint.get('catalogSearch', '/api/operator/catalog/search')
      .setUrlParams(CatalogSearchQuery)
      .addSuccess(CatalogSearchResult)
      .addError(CatalogUnavailable, { status: 502 }),
  )
  .add(
    HttpApiEndpoint.get('catalogCheck', '/api/operator/catalog/check').addSuccess(
      CatalogCheckResult,
    ),
  )
  .add(
    HttpApiEndpoint.post('webhooksRegister', '/api/operator/webhooks/register')
      .setPayload(WebhookRegisterRequest)
      .addSuccess(WebhookRegisterResult)
      .addError(ToolError, { status: 422 }),
  )
  .add(
    HttpApiEndpoint.post('printfileCheck', '/api/operator/printfile/check')
      .setPayload(PrintfileCheckRequest)
      .addSuccess(PrintfileCheckResult)
      .addError(ToolError, { status: 422 }),
  )
  .add(
    HttpApiEndpoint.get('reconciliation', '/api/operator/reconciliation/latest').addSuccess(
      Schema.NullOr(ReconciliationReport),
    ),
  )
  .middleware(OperatorAuth);

/** Scheduled entry for Vercel Cron (Cloudflare uses the `scheduled` export instead, ADR-0012). */
export const CronGroup = HttpApiGroup.make('cron').add(
  HttpApiEndpoint.get('reconcile', '/api/cron/reconcile')
    .setHeaders(Schema.Struct({ authorization: Schema.optional(Schema.String) }))
    .addSuccess(ReconciliationReport)
    .addError(Unauthorized, { status: 401 }),
);

export class PresslineApi extends HttpApi.make('pressline')
  .add(HealthGroup)
  .add(CatalogGroup)
  .add(DesignsGroup)
  .add(PrintfilesGroup)
  .add(QuotesGroup)
  .add(OrdersGroup)
  .add(WebhooksGroup)
  .add(OperatorGroup)
  .add(CronGroup) {}
