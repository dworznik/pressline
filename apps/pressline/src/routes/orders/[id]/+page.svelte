<script lang="ts">
  import { copy } from '$lib/copy'
  import { formatMoney } from '$lib/money'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
  const order = $derived(data.order)
  const display = $derived(data.display)
  const money = (amount: number) => formatMoney(amount, order.currency)
  const steps = ['paid', 'making', 'shipped', 'done'] as const
  const reached = (step: (typeof steps)[number]) =>
    steps.indexOf(step) <= steps.indexOf(display.step as never)
</script>

<svelte:head>
  <title>Order {data.reference} · {display.label}</title>
</svelte:head>

<main class="status" data-step={display.step}>
  <header>
    <p class="ref">{copy.status.order} <code>{data.reference}</code></p>
    <h1>{display.label}</h1>
    <p>{display.detail}</p>
  </header>

  {#if display.step !== 'closed' && display.step !== 'placed'}
    <ol class="steps">
      {#each steps as step (step)}
        <li class:reached={reached(step)}>
          {copy.status.steps[step]}
        </li>
      {/each}
    </ol>
  {/if}

  <section class="item">
    {#if order.previewUrl}
      <img src={order.previewUrl} alt={copy.status.designAlt} />
    {/if}
    <div>
      <h2>{order.offerName}</h2>
      <p>{order.variantLabel}</p>
      <p class="price">{money(order.amountTotal ?? order.retail + order.shipping)}</p>
    </div>
  </section>

  {#if order.tracking?.url}
    <p class="tracking">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href={order.tracking.url} rel="noopener noreferrer"
        >{copy.status.trackParcel(order.tracking.carrier)}</a
      >
    </p>
  {/if}

  {#if order.recipient}
    <p class="recipient">
      {copy.status.shippingTo(
        order.recipient.firstName,
        order.recipient.city,
        order.recipient.country,
      )}
    </p>
  {/if}
</main>

<style>
  .status {
    max-width: 40rem;
    margin: 3rem auto;
    padding: 0 1rem;
  }
  .ref {
    color: #666;
  }
  .steps {
    display: flex;
    gap: 0.5rem;
    list-style: none;
    padding: 0;
    margin: 1.5rem 0;
  }
  .steps li {
    flex: 1;
    padding: 0.5rem;
    text-align: center;
    border-top: 4px solid #ddd;
    color: #999;
    font-size: 0.9rem;
  }
  .steps li.reached {
    border-color: #333;
    color: #222;
  }
  .item {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin: 1.5rem 0;
  }
  .item img {
    width: 6rem;
    height: auto;
    border-radius: 0.5rem;
  }
  .item h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .price {
    font-weight: 600;
  }
  .recipient {
    color: #555;
  }
</style>
