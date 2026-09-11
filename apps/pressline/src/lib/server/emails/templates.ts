import { orderReference } from '../orders/ids';
import type { Order } from '../orders/orders';
import type { Email } from '../services/mailer';

/**
 * Customer emails (ticket #12): plain server-rendered HTML with a text
 * twin. No template engine: the two emails are short, and every value is
 * escaped here. Branding is the Operator's name and colours from config.
 */
export interface EmailContext {
  readonly shopName: string;
  readonly logoUrl?: string;
  readonly accent: string;
  readonly accentText: string;
  readonly withdrawalNotice: string;
  readonly contactEmail?: string;
  readonly offerName: string;
  readonly variantLabel: string;
  readonly previewUrl?: string;
  readonly statusUrl: string;
  readonly currency: string;
}

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const money = (amount: number, currency: string) => {
  const fmt = new Intl.NumberFormat('en', { style: 'currency', currency });
  return fmt.format(amount / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 2));
};

const shell = (title: string, body: string, ctx: EmailContext) => `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #222; max-width: 36rem; margin: 0 auto; padding: 1.5rem;">
  <p style="border-bottom: 3px solid ${esc(ctx.accent)}; padding-bottom: 0.75rem; font-weight: 600;">${
    ctx.logoUrl
      ? `<img src="${esc(ctx.logoUrl)}" alt="${esc(ctx.shopName)}" style="max-height: 40px;">`
      : esc(ctx.shopName)
  }</p>
  <h1 style="font-size: 1.4rem;">${esc(title)}</h1>
  ${body}
  <p style="color: #666; font-size: 0.9rem; margin-top: 2rem;">${esc(ctx.shopName)}${ctx.contactEmail ? ` · <a href="mailto:${esc(ctx.contactEmail)}">${esc(ctx.contactEmail)}</a>` : ''}</p>
</body></html>`;

const ref = (order: Order) => orderReference(order.id);

export const confirmationEmail = (order: Order, ctx: EmailContext): Email => {
  const to = order.recipient?.email ?? '';
  const subject = `${ctx.shopName}: order ${ref(order)} confirmed`;
  const total = order.amountTotal ?? order.retail + order.shipping;
  const lines = [
    `${ctx.offerName} · ${ctx.variantLabel}`,
    `Total paid: ${money(total, ctx.currency)} (incl. shipping${order.amountTax ? ' and tax' : ''})`,
  ];
  const contact = ctx.contactEmail
    ? `Need to change the size or address? Write to ${ctx.contactEmail} straight away; production starts soon.`
    : 'Need to change the size or address? Reply to this email straight away; production starts soon.';
  const html = shell(
    `Thanks, ${esc(order.recipient?.name?.split(/\s+/)[0] ?? 'there')}!`,
    `
    <p>We have your order <strong>${esc(ref(order))}</strong> and are sending it to print.</p>
    ${ctx.previewUrl ? `<p><img src="${esc(ctx.previewUrl)}" alt="Your design" style="max-width: 100%; border-radius: 6px;"></p>` : ''}
    <p>${esc(lines[0]!)}<br>${esc(lines[1]!)}</p>
    <p><a href="${esc(ctx.statusUrl)}">Track this order</a></p>
    <p>${esc(contact)}</p>
    <p style="font-size: 0.9rem; color: #555; border-top: 1px solid #ddd; padding-top: 0.75rem;">${esc(ctx.withdrawalNotice)}</p>`,
    ctx,
  );
  const text = [
    `Thanks! We have your order ${ref(order)} and are sending it to print.`,
    ...lines,
    `Track this order: ${ctx.statusUrl}`,
    contact,
    '',
    ctx.withdrawalNotice,
    '',
    ctx.shopName + (ctx.contactEmail ? ` · ${ctx.contactEmail}` : ''),
  ].join('\n');
  return { to, subject, html, text, idempotencyKey: `${order.id}:confirmation` };
};

export const shippedEmail = (order: Order, ctx: EmailContext): Email => {
  const to = order.recipient?.email ?? '';
  const subject = `${ctx.shopName}: order ${ref(order)} is on its way`;
  const raw = order.tracking;
  // Only web URLs are linked; the carrier link came from the provider.
  const t = raw && raw.url && !/^https?:\/\//i.test(raw.url) ? { ...raw, url: undefined } : raw;
  const trackingLine = t?.url
    ? `Track your parcel${t.carrier ? ` with ${t.carrier}` : ''}: ${t.url}`
    : t?.number
      ? `Tracking number${t.carrier ? ` (${t.carrier})` : ''}: ${t.number}`
      : 'Your parcel is on its way.';
  const html = shell(
    'Your order has shipped',
    `
    <p>Order <strong>${esc(ref(order))}</strong> (${esc(ctx.offerName)} · ${esc(ctx.variantLabel)}) has left the print house.</p>
    <p>${t?.url ? `<a href="${esc(t.url)}">${esc(trackingLine)}</a>` : esc(trackingLine)}</p>
    <p><a href="${esc(ctx.statusUrl)}">Order status</a></p>`,
    ctx,
  );
  const text = [
    `Order ${ref(order)} (${ctx.offerName} · ${ctx.variantLabel}) has left the print house.`,
    trackingLine,
    `Order status: ${ctx.statusUrl}`,
    '',
    ctx.shopName + (ctx.contactEmail ? ` · ${ctx.contactEmail}` : ''),
  ].join('\n');
  return { to, subject, html, text, idempotencyKey: `${order.id}:shipped` };
};
