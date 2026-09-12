<script lang="ts">
  import { resolve } from '$app/paths';
  import { copy } from '$lib/copy';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const order = $derived(data.order);
  const statusHref = $derived(
    `${resolve('/orders/[id]', { id: data.order.id })}?t=${encodeURIComponent(data.token)}`,
  );
  // Stripe redirects here as soon as payment succeeds; the webhook that marks
  // the Order paid may land a moment later, so "still confirming" is normal.
  // In Demo Mode every paid Order is canceled at once; say so instead of promising a shipment.
  const tone = $derived(
    order.state === 'checkout_open'
      ? 'confirming'
      : order.state === 'expired'
        ? 'expired'
        : order.demo
          ? 'demo'
          : order.state === 'canceled' || order.state === 'refunded'
            ? 'canceled'
            : 'confirmed',
  );
</script>

<svelte:head>
  <title>{copy.thanks.tabTitle(data.reference)}</title>
</svelte:head>

<main class="thanks" data-tone={tone}>
  <h1>{copy.thanks[tone].title}</h1>
  <p>{copy.thanks[tone].text}</p>
  <p class="ref">{copy.thanks.reference} <code>{data.reference}</code></p>
  <p>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href={statusHref} class="track">{copy.thanks.track}</a>
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
