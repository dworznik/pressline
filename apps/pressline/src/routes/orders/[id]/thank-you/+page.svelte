<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const order = $derived(data.order);
  // Stripe redirects here as soon as payment succeeds; the webhook that marks
  // the Order paid may land a moment later, so both states read as success.
  const paid = $derived(order.state !== 'checkout_open' && order.state !== 'expired');
</script>

<svelte:head>
  <title>Thank you · Order {order.id.slice(0, 8)}</title>
</svelte:head>

<main class="thanks" data-state={order.state}>
  <h1>Thank you!</h1>
  {#if paid}
    <p>Your order is confirmed. We will email you when it ships.</p>
  {:else}
    <p>We are confirming your payment. You will get an email with your order details shortly.</p>
  {/if}
  <p class="ref">Order reference: <code>{order.id}</code></p>
  <!-- The order-status page (ticket #13) is linked from here and from the emails. -->
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
