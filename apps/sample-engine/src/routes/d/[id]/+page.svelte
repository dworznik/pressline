<script lang="ts">
  import type { PageData } from './$types'
  let { data }: { data: PageData } = $props()
  const d = $derived(data.design)
</script>

<svelte:head><title>{d.title} · Sample Engine</title></svelte:head>

<main class="design">
  <img src={d.previewUrl} alt={d.title} />
  <div>
    <h1>{d.title}</h1>
    <p class="meta">
      Design <code>{d.id}</code>
      {#if d.offers}
        · print files ready for {d.offers.length} product{d.offers.length === 1 ? '' : 's'}
      {/if}
    </p>
    {#if data.orderUrl}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="order" href={data.orderUrl} data-order>Order a print</a>
    {:else}
      <p class="meta">Set <code>PRESSLINE_URL</code> to add the "Order a print" button.</p>
    {/if}
  </div>
</main>

<style>
  .design {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 2rem;
    max-width: 64rem;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
  }
  img {
    width: 100%;
    height: auto;
    border-radius: 0.5rem;
    /* A light backdrop, so a transparent design still shows its edges. */
    background: #f1f1f1;
  }
  .meta {
    color: #555;
  }
  .order {
    display: inline-block;
    padding: 0.7rem 1.4rem;
    border-radius: 0.5rem;
    background: #222;
    color: white;
    text-decoration: none;
  }
</style>
