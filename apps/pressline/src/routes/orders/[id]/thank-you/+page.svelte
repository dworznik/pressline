<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const order = $derived(data.order);
  const statusHref = $derived(
    `${resolve('/orders/[id]', { id: data.order.id })}?t=${encodeURIComponent(data.token)}`,
  );
  // Stripe redirects here as soon as payment succeeds; the webhook that marks
  // the Order paid may land a moment later, so "still confirming" is normal.
  const tone = $derived(
    order.state === 'checkout_open'
      ? 'confirming'
      : order.state === 'expired'
        ? 'expired'
        : order.state === 'cancelled' || order.state === 'refunded'
          ? 'cancelled'
          : 'confirmed',
  );
</script>

<svelte:head>
  <title>Thank you · Order {order.id.slice(0, 8)}</title>
</svelte:head>

<main class="thanks" data-tone={tone}>
  {#if tone === 'confirmed'}
    <h1>Thank you!</h1>
    <p>Your order is confirmed. We will email you when it ships.</p>
  {:else if tone === 'confirming'}
    <h1>Thank you!</h1>
    <p>We are confirming your payment. You will get an email with your order details shortly.</p>
  {:else if tone === 'expired'}
    <h1>This checkout has expired</h1>
    <p>No payment was taken. Please start again from your design.</p>
  {:else}
    <h1>This order was cancelled</h1>
    <p>If you were charged, the refund will arrive on the same payment method.</p>
  {/if}
  <p class="ref">Order reference: <code>{data.reference}</code></p>
  <p>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href={statusHref}>Track this order</a>
  </p>
</main>

<style>
  .thanks {
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1rem;
    text-align: center;
  }
  .ref {
    color: #555;
  }
</style>
