/**
 * Every Customer-facing string in one place (ticket #19). English only in v1
 * (ADR-0015); a later locale swaps this module. Emails keep their own copy in
 * `server/emails/templates.ts` because they render on the server with escaping.
 */
export const copy = {
  home: {
    title: 'Pressline',
    text: 'This instance is running. Storefront pages are served under /order/…',
  },
  design: {
    notFound: 'We could not find that design.',
    unavailable: 'This shop is temporarily unavailable. Please try again soon.',
    engineDown: 'The design app did not answer. Please try again in a moment.',
    fallbackTitle: 'Your design',
    tabTitle: (title: string) => `${title} · Order a print`,
    demoBanner: (testCard: string) =>
      `Demo shop: nothing is charged and nothing is printed. At checkout, pay with the test card ${testCard}, any future expiry and any CVC.`,
    canceled: 'Payment was canceled. Your design is still here when you are ready.',
    notSellable: 'This design is no longer available to order.',
    noOffers: "No products currently fit this design's shape.",
    exclShipping: 'excl. shipping and tax',
    shipTo: 'Ship to',
    chooseCountry: 'Choose a country',
    stateLabel: 'State / province',
    statePlaceholder: 'e.g. CA',
    pricing: 'Getting a price…',
    shipping: 'Shipping',
    days: 'days',
    total: 'Total',
    taxNote: 'Tax is calculated at payment.',
    priceError: 'We could not price this right now. Please try again.',
    preparing: 'Preparing your print file… this can take a moment.',
    ready: (w: number, h: number) => `Your print file is ready (${w}×${h}).`,
    continue: 'Continue to payment',
    opening: 'Opening payment…',
    checkoutError: 'We could not start the payment. Please try again.',
    networkError: 'Network error. Please try again.',
    engineError: 'The design app did not answer. Please try again.',
    retry: 'Retry',
    mockupEngine: 'Mockup from the design app.',
    mockupOverlay: 'Illustrative: placement and size on the product are approximate.',
    previewAlt: (title: string) => `${title} on the product`,
  },
  thanks: {
    tabTitle: (ref: string) => `Thank you · Order ${ref}`,
    confirmed: {
      title: 'Thank you!',
      text: 'Your order is confirmed. We will email you when it ships.',
    },
    confirming: {
      title: 'Thank you!',
      text: 'We are confirming your payment. You will get an email with your order details shortly.',
    },
    expired: {
      title: 'This checkout has expired',
      text: 'No payment was taken. Please start again from your design.',
    },
    canceled: {
      title: 'This order was canceled',
      text: 'If you were charged, the refund will arrive on the same payment method.',
    },
    demo: {
      title: 'Thank you!',
      text: 'This is a demo shop. Your test payment went through, the print order was created at the print provider and canceled straight away, so nothing is produced, shipped or charged. A real order takes exactly this path, minus the cancellation.',
    },
    reference: 'Order reference:',
    track: 'Track this order',
  },
  status: {
    notFound: 'We could not find that order.',
    tryAgain: 'Please try again in a moment.',
    order: 'Order',
    steps: { paid: 'Confirmed', making: 'Being made', shipped: 'Shipped', done: 'Done' },
    trackParcel: (carrier?: string) => `Track your parcel${carrier ? ` with ${carrier}` : ''}`,
    shippingTo: (name: string, city: string, country: string) =>
      `Shipping to ${name}, ${city}, ${country}`,
    designAlt: 'Your design',
  },
  layout: {
    terms: 'Terms',
    privacy: 'Privacy',
    contact: 'Contact',
    poweredBy: 'Powered by Pressline',
  },
  error: { fallback: 'Something went wrong.' },
} as const
