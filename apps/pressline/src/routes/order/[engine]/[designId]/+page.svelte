<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const design = $derived(data.page.design);
  const offers = $derived(data.page.offers);
  const money = $derived((amount: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: data.page.currency }).format(
      amount / 100,
    ),
  );
</script>

<svelte:head>
  <title>{design.title ?? 'Your design'} · Order a print</title>
</svelte:head>

<main class="design">
  <figure class="preview">
    <img src={design.previewUrl} alt={design.title ?? 'Your design'} />
  </figure>

  <section class="details">
    <h1>{design.title ?? 'Your design'}</h1>

    {#if !design.sellable}
      <p class="notice" data-state="not-sellable">This design is no longer available to order.</p>
    {:else if offers.length === 0}
      <p class="notice" data-state="no-offers">No products currently fit this design's shape.</p>
    {:else}
      <ul class="offers" data-state="offers">
        {#each offers as offer (offer.slug)}
          <li class="offer">
            <h2>{offer.name}</h2>
            <p class="price">
              {money(offer.retailPrice.amount)} <small>excl. shipping and tax</small>
            </p>
            <p class="variants">
              {#each offer.variants as variant (variant.key)}
                <span class="variant">{variant.label}</span>
              {/each}
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .design {
    display: grid;
    gap: 2rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    max-width: 64rem;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  @media (max-width: 40rem) {
    .design {
      grid-template-columns: 1fr;
    }
  }
  .preview img {
    width: 100%;
    height: auto;
    border-radius: 0.5rem;
  }
  .offers {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 1rem;
  }
  .offer {
    border: 1px solid #ddd;
    border-radius: 0.5rem;
    padding: 1rem;
  }
  .variant {
    display: inline-block;
    margin-right: 0.5rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid #ccc;
    border-radius: 999px;
  }
  .notice {
    padding: 1rem;
    background: #fff4e5;
    border-radius: 0.5rem;
  }
</style>
