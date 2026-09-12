import type { OrderState } from './state'

/**
 * How an Order state reads to the Customer (ticket #13). Internal states
 * collapse: anything between paid and shipped is "being made", the
 * Operator-only states read as "confirmed" (they are being handled).
 */
export interface StateDisplay {
  readonly label: string
  readonly detail: string
  readonly step: 'placed' | 'paid' | 'making' | 'shipped' | 'done' | 'closed'
}

export const describeState = (state: OrderState, demo = false): StateDisplay => {
  // Demo Mode: a paid Order is created at the print provider and canceled straight away.
  if (demo && state !== 'checkout_open' && state !== 'expired') {
    return {
      label: 'Demo order',
      detail:
        'This is a demo shop: the print order was created at the print provider and canceled straight away. Nothing is produced, shipped or charged.',
      step: 'closed',
    }
  }
  switch (state) {
    case 'checkout_open':
      return {
        label: 'Awaiting payment',
        detail: 'Complete the payment to place this order.',
        step: 'placed',
      }
    case 'expired':
      return {
        label: 'Checkout expired',
        detail: 'No payment was taken. Start again from your design.',
        step: 'closed',
      }
    case 'paid':
    case 'submit_failed':
    case 'submitted':
    case 'on_hold':
      return {
        label: 'Confirmed',
        detail: 'We have your payment and are preparing your order for print.',
        step: 'paid',
      }
    case 'in_production':
      return {
        label: 'Being made',
        detail: 'Your item is being printed and packed.',
        step: 'making',
      }
    case 'shipped':
      return { label: 'Shipped', detail: 'Your parcel is on its way.', step: 'shipped' }
    case 'fulfilled':
      return {
        label: 'Delivered to the carrier',
        detail: 'Everything in this order has shipped.',
        step: 'done',
      }
    case 'canceled':
      return {
        label: 'Canceled',
        detail: 'This order was canceled. Any payment is refunded to the same method.',
        step: 'closed',
      }
    case 'refunded':
      return {
        label: 'Refunded',
        detail: 'The payment for this order has been refunded.',
        step: 'closed',
      }
  }
}
