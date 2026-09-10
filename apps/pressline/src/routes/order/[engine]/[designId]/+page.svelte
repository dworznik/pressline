<script lang="ts">
  import { COUNTRIES, STATE_REQUIRED } from '$lib/countries';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const design = $derived(data.page.design);
  const offers = $derived(data.page.offers);
  const money = $derived((amount: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: data.page.currency }).format(
      amount / 100,
    ),
  );

  // Selection → ensure-Printfile (ticket #6): POST waits within the server's
  // bound; on 202 the page polls GET until ready. Nothing here decides prices
  // or eligibility: the server already did.
  type Printfile = { url: string; width: number; height: number };
  type State =
    | { kind: 'idle' }
    | { kind: 'preparing'; retryAfterMs: number }
    | { kind: 'ready'; printfile: Printfile }
    | { kind: 'unavailable'; message: string }
    | { kind: 'error'; message: string };

  let offerSlug = $state<string | undefined>(undefined);
  let variantKey = $state<string | undefined>(undefined);
  let printfile = $state<State>({ kind: 'idle' });
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer)); // stop polling when the page goes away

  // Narrow guards for the two bodies this island reads; the server validated
  // them with Schema already, this only protects against a wrong deploy pairing.
  const isReady = (b: unknown): b is { printfile: Printfile } =>
    typeof b === 'object' && b !== null && 'printfile' in b;
  const isPreparing = (b: unknown): b is { retryAfterMs: number } =>
    typeof b === 'object' &&
    b !== null &&
    typeof (b as { retryAfterMs?: unknown }).retryAfterMs === 'number';
  const hasMessage = (b: unknown): b is { message: string } =>
    typeof b === 'object' && b !== null && typeof (b as { message?: unknown }).message === 'string';

  const offer = $derived(offers.find((o) => o.slug === offerSlug));
  const base = $derived(`/api/designs/${data.page.engine}/${design.id}/printfile`);

  // Quote (ticket #7): re-fetched whenever the variant or destination changes.
  type Quote = {
    id: string;
    retail: number;
    shipping: number;
    total: number;
    shippingMethod: { name: string; minDeliveryDays?: number; maxDeliveryDays?: number };
  };
  type QuoteState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; quote: Quote }
    | { kind: 'unavailable'; message: string }
    | { kind: 'error'; message: string };
  let country = $state('');
  let stateCode = $state('');
  let quote = $state<QuoteState>({ kind: 'idle' });
  let quoteAttempt = 0;
  const needsState = $derived(STATE_REQUIRED.has(country));
  const isQuote = (b: unknown): b is Quote =>
    typeof b === 'object' && b !== null && typeof (b as { total?: unknown }).total === 'number';

  const fetchQuote = async () => {
    if (!offerSlug || !variantKey || !country || (needsState && !stateCode)) {
      quote = { kind: 'idle' };
      return;
    }
    const mine = ++quoteAttempt;
    quote = { kind: 'loading' };
    const params = new URLSearchParams({
      engine: data.page.engine,
      designId: design.id,
      offer: offerSlug,
      variant: variantKey,
      country,
      ...(needsState ? { state: stateCode.toUpperCase() } : {}),
    });
    try {
      const res = await fetch(`/api/quote?${params}`);
      const body: unknown = await res.json().catch(() => undefined);
      if (mine !== quoteAttempt) return;
      if (res.status === 200 && isQuote(body)) quote = { kind: 'ready', quote: body };
      else if (res.status === 422 && hasMessage(body))
        quote = { kind: 'unavailable', message: body.message };
      else
        quote = { kind: 'error', message: 'We could not price this right now. Please try again.' };
    } catch {
      if (mine === quoteAttempt)
        quote = { kind: 'error', message: 'Network error. Please try again.' };
    }
  };

  const choose = (slug: string, key: string) => {
    offerSlug = slug;
    variantKey = key;
    void ensure();
    void fetchQuote();
  };

  const apply = async (res: Response, mine: number) => {
    if (mine !== attempt) return;
    const body: unknown = await res.json().catch(() => undefined);
    if (res.status === 200 && isReady(body)) {
      printfile = { kind: 'ready', printfile: body.printfile };
    } else if (res.status === 202 && isPreparing(body)) {
      printfile = { kind: 'preparing', retryAfterMs: body.retryAfterMs };
      timer = setTimeout(() => void poll(mine), Math.max(250, body.retryAfterMs));
    } else if (res.status === 422 && hasMessage(body)) {
      printfile = { kind: 'unavailable', message: body.message };
    } else {
      printfile = { kind: 'error', message: 'The design app did not answer. Please try again.' };
    }
  };

  const ensure = async () => {
    if (!offerSlug || !variantKey) return;
    const mine = ++attempt;
    printfile = { kind: 'preparing', retryAfterMs: 0 };
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offer: offerSlug, variant: variantKey }),
      });
      await apply(res, mine);
    } catch {
      if (mine === attempt)
        printfile = { kind: 'error', message: 'Network error. Please try again.' };
    }
  };

  const poll = async (mine: number) => {
    if (mine !== attempt || !offerSlug || !variantKey) return;
    try {
      const res = await fetch(`${base}?offer=${offerSlug}&variant=${variantKey}`);
      await apply(res, mine);
    } catch {
      if (mine === attempt)
        printfile = { kind: 'error', message: 'Network error. Please try again.' };
    }
  };
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
        {#each offers as o (o.slug)}
          <li class="offer" class:selected={o.slug === offerSlug}>
            <h2>{o.name}</h2>
            <p class="price">
              {money(o.retailPrice.amount)} <small>excl. shipping and tax</small>
            </p>
            <p class="variants">
              {#each o.variants as v (v.key)}
                <button
                  type="button"
                  class="variant"
                  class:selected={o.slug === offerSlug && v.key === variantKey}
                  onclick={() => choose(o.slug, v.key)}
                >
                  {v.label}
                </button>
              {/each}
            </p>
          </li>
        {/each}
      </ul>

      {#if offer && variantKey}
        <div class="destination">
          <label>
            Ship to
            <select bind:value={country} onchange={() => void fetchQuote()}>
              <option value="">Choose a country</option>
              {#each COUNTRIES as [code, name] (code)}
                <option value={code}>{name}</option>
              {/each}
            </select>
          </label>
          {#if needsState}
            <label>
              State / province
              <input
                bind:value={stateCode}
                maxlength="3"
                placeholder="e.g. CA"
                oninput={() => stateCode.length >= 2 && void fetchQuote()}
              />
            </label>
          {/if}
        </div>

        <div class="quote" data-quote={quote.kind}>
          {#if quote.kind === 'loading'}
            <p>Getting a price…</p>
          {:else if quote.kind === 'ready'}
            <dl>
              <dt>{offer.name}</dt>
              <dd>{money(quote.quote.retail)}</dd>
              <dt>
                Shipping ({quote.quote.shippingMethod
                  .name}{#if quote.quote.shippingMethod.minDeliveryDays},
                  {quote.quote.shippingMethod.minDeliveryDays}–{quote.quote.shippingMethod
                    .maxDeliveryDays} days{/if})
              </dt>
              <dd>{money(quote.quote.shipping)}</dd>
              <dt class="total">Total</dt>
              <dd class="total">{money(quote.quote.total)}</dd>
            </dl>
            <p class="tax-note">Tax is calculated at payment.</p>
          {:else if quote.kind === 'unavailable' || quote.kind === 'error'}
            <p class="notice">{quote.message}</p>
          {/if}
        </div>

        <div class="printfile" data-printfile={printfile.kind}>
          {#if printfile.kind === 'preparing'}
            <p>Preparing your print file… this can take a moment.</p>
          {:else if printfile.kind === 'ready'}
            <p>
              Your print file is ready ({printfile.printfile.width}×{printfile.printfile.height}).
            </p>
            <p class="withdrawal" data-withdrawal>{data.page.storefront.withdrawalNotice}</p>
            <!-- Checkout arrives with ticket #8; until then the button only reflects readiness. -->
            <button type="button" class="continue" disabled={quote.kind !== 'ready'}>
              Continue to payment
            </button>
          {:else if printfile.kind === 'unavailable'}
            <p class="notice">{printfile.message}</p>
          {:else if printfile.kind === 'error'}
            <p class="notice">
              {printfile.message} <button type="button" onclick={() => void ensure()}>Retry</button>
            </p>
          {/if}
        </div>
      {/if}
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
  .offer.selected {
    border-color: #333;
  }
  .variant {
    margin-right: 0.5rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid #ccc;
    border-radius: 999px;
    background: white;
    cursor: pointer;
  }
  .variant.selected {
    background: #333;
    color: white;
    border-color: #333;
  }
  .notice {
    padding: 1rem;
    background: #fff4e5;
    border-radius: 0.5rem;
  }
  .printfile,
  .destination,
  .quote {
    margin-top: 1rem;
  }
  .destination label {
    display: block;
    margin-bottom: 0.5rem;
  }
  .quote dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 1rem;
    margin: 0;
  }
  .quote dd {
    margin: 0;
    text-align: right;
  }
  .quote .total {
    font-weight: 600;
    border-top: 1px solid #ddd;
    padding-top: 0.25rem;
  }
  .tax-note,
  .withdrawal {
    font-size: 0.9rem;
    color: #555;
  }
  .continue {
    padding: 0.6rem 1.2rem;
    border-radius: 0.5rem;
    border: none;
    background: #333;
    color: white;
  }
</style>
