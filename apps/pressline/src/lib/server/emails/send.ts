import { Clock, Effect, Schema } from 'effect';
import { Config } from '../config/schema';
import { Db } from '../db/db';
import { findOrder } from '../orders/orders';
import { DesignSource } from '../services/design-source';
import { Mailer } from '../services/mailer';
import { confirmationEmail, shippedEmail, type EmailContext } from './templates';

/**
 * Customer emails are sent once per Order and kind, recorded in
 * `order_emails`. A failed send is recorded with its error and retried by
 * Reconciliation (ticket #15); it never blocks the Transition that
 * triggered it.
 */
export const EmailKind = Schema.Literal('confirmation', 'shipped');
export type EmailKind = typeof EmailKind.Type;

export const OrderEmail = Schema.Struct({
  orderId: Schema.String,
  kind: EmailKind,
  sentAt: Schema.optional(Schema.Int),
  providerMessageId: Schema.optional(Schema.String),
  attempts: Schema.Int,
  lastError: Schema.optional(Schema.String),
});
export type OrderEmail = typeof OrderEmail.Type;

type Row = {
  order_id: string;
  kind: EmailKind;
  sent_at: number | null;
  provider_message_id: string | null;
  attempts: number;
  last_error: string | null;
};

const fromRow = (r: Row): OrderEmail => ({
  orderId: r.order_id,
  kind: r.kind,
  ...(r.sent_at !== null ? { sentAt: r.sent_at } : {}),
  ...(r.provider_message_id !== null ? { providerMessageId: r.provider_message_id } : {}),
  attempts: r.attempts,
  ...(r.last_error !== null ? { lastError: r.last_error } : {}),
});

export const listOrderEmails = (orderId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* db.all<Row>('SELECT * FROM order_emails WHERE order_id = ? ORDER BY kind', [
      orderId,
    ]);
    return rows.map(fromRow);
  }).pipe(Effect.orDie);

/** Emails that failed and should be retried (Reconciliation). */
export const listUnsentEmails = (maxAttempts = 5) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* db.all<Row>(
      'SELECT * FROM order_emails WHERE sent_at IS NULL AND attempts < ? ORDER BY updated_at',
      [maxAttempts],
    );
    return rows.map(fromRow);
  }).pipe(Effect.orDie);

const record = (
  orderId: string,
  kind: EmailKind,
  result: { messageId?: string } | { error: string },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    const ok = !('error' in result);
    yield* db.run(
      `INSERT INTO order_emails (order_id, kind, sent_at, provider_message_id, attempts, last_error, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (order_id, kind) DO UPDATE SET
         sent_at = COALESCE(order_emails.sent_at, excluded.sent_at),
         provider_message_id = COALESCE(excluded.provider_message_id, order_emails.provider_message_id),
         attempts = order_emails.attempts + 1,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        orderId,
        kind,
        ok ? now : null,
        ok ? (result.messageId ?? null) : null,
        ok ? null : result.error,
        now,
      ],
    );
  }).pipe(Effect.orDie);

const contextFor = (orderId: string) =>
  Effect.gen(function* () {
    const order = yield* findOrder(orderId);
    const config = yield* Config;
    const offer = config.catalog.offers.find((o) => o.slug === order.offer);
    const variant = offer?.variants[order.variant];
    // The Preview was captured at checkout; ask the Engine only for Orders from before that column existed.
    const previewUrl =
      order.previewUrl ??
      (yield* Effect.flatMap(DesignSource, (s) => s.getDesign(order.engine, order.designId)).pipe(
        Effect.map((d) => d.previewUrl),
        Effect.option,
        Effect.map((o) => (o._tag === 'Some' ? o.value : undefined)),
      ));
    const origin = (config.checkout.publicUrl ?? order.publicOrigin ?? '').replace(/\/$/, '');
    const ctx: EmailContext = {
      shopName: config.name,
      ...(config.branding.logoUrl ? { logoUrl: config.branding.logoUrl } : {}),
      accent: config.branding.accent,
      accentText: config.branding.accentText,
      ...(config.legal.termsUrl ? { termsUrl: config.legal.termsUrl } : {}),
      ...(config.legal.privacyUrl ? { privacyUrl: config.legal.privacyUrl } : {}),
      withdrawalNotice: config.legal.withdrawalNotice,
      ...(config.legal.contactEmail ? { contactEmail: config.legal.contactEmail } : {}),
      offerName: offer?.name ?? order.offer,
      variantLabel: variant?.label ?? order.variant,
      ...(previewUrl ? { previewUrl } : {}),
      statusUrl: `${origin}/orders/${order.id}?t=${encodeURIComponent(order.statusToken)}`,
      currency: order.currency,
    };
    return { order, ctx };
  });

/**
 * Send one kind of email for an Order, once. Returns what happened; never
 * fails (a Mailer failure is recorded for retry and logged).
 */
export const sendOrderEmail = (orderId: string, kind: EmailKind) =>
  Effect.gen(function* () {
    const existing = (yield* listOrderEmails(orderId)).find((e) => e.kind === kind);
    if (existing?.sentAt) return 'already_sent' as const;
    const { order, ctx } = yield* contextFor(orderId);
    if (!order.recipient?.email) {
      yield* record(orderId, kind, { error: 'no recipient email on the Order' });
      return 'no_recipient' as const;
    }
    const email =
      kind === 'confirmation' ? confirmationEmail(order, ctx) : shippedEmail(order, ctx);
    const mailer = yield* Mailer;
    const sent = yield* mailer.send(email).pipe(Effect.either);
    if (sent._tag === 'Left') {
      yield* Effect.logWarning(`order ${orderId}: ${kind} email failed: ${sent.left.message}`);
      yield* record(orderId, kind, { error: sent.left.message });
      return 'failed' as const;
    }
    yield* record(orderId, kind, sent.right ? { messageId: sent.right } : {});
    return 'sent' as const;
  }).pipe(
    Effect.catchAll((e) =>
      Effect.logWarning(`order ${orderId}: ${kind} email skipped: ${String(e)}`).pipe(
        Effect.as('skipped' as const),
      ),
    ),
  );
