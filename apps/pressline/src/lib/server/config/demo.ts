/** Stripe key prefixes that move real money. Demo Mode refuses to boot with one. */
const LIVE_KEY = /^(sk|rk)_live_/

export const STRIPE_TEST_CARD = '4242 4242 4242 4242'

/**
 * Demo Mode invariant (ticket #18): no money moves. A live Stripe key with
 * `demo: true` is a misconfiguration the instance must not start with.
 */
export const assertDemoSafe = (demo: boolean, stripeSecretKey: string | undefined): void => {
  if (demo && stripeSecretKey && LIVE_KEY.test(stripeSecretKey)) {
    throw new Error(
      'Demo Mode refuses a live Stripe key: set STRIPE_SECRET_KEY to a test-mode key (sk_test_…) or turn `demo` off',
    )
  }
}
