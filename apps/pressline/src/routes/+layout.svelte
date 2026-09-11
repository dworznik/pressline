<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { copy } from '$lib/copy';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  const b = $derived(data.branding);
  // The Operator View has its own chrome; the Storefront gets the Operator's brand.
  const storefront = $derived(!page.url.pathname.startsWith('/operator'));
</script>

<svelte:head>
  {#if b.logoUrl}<link rel="icon" href={b.logoUrl} />{/if}
</svelte:head>

<div
  class="shell"
  class:storefront
  style={storefront ? `--accent: ${b.accent}; --accent-text: ${b.accentText};` : ''}
>
  {#if storefront}
    <header class="brand" data-brand>
      {#if b.logoUrl}
        <img src={b.logoUrl} alt={b.name} class="logo" />
      {:else}
        <span class="name">{b.name}</span>
      {/if}
      {#if b.tagline}<span class="tagline">{b.tagline}</span>{/if}
    </header>
  {/if}
  {@render children()}
  {#if storefront}
    <footer class="legal">
      <!-- eslint-disable svelte/no-navigation-without-resolve -->
      {#if b.termsUrl}<a href={b.termsUrl}>{copy.layout.terms}</a>{/if}
      {#if b.privacyUrl}<a href={b.privacyUrl}>{copy.layout.privacy}</a>{/if}
      {#if b.contactEmail}<a href="mailto:{b.contactEmail}">{copy.layout.contact}</a>{/if}
      <a href="https://pressline.dev" rel="noopener">{copy.layout.poweredBy}</a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    </footer>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    color: #222;
  }
  .storefront :global(a) {
    color: var(--accent);
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    max-width: 64rem;
    margin: 1rem auto 0;
    padding: 0 1rem 0.75rem;
    border-bottom: 3px solid var(--accent);
  }
  .logo {
    max-height: 2.5rem;
  }
  .name {
    font-weight: 700;
    font-size: 1.25rem;
  }
  .tagline {
    color: #666;
  }
  .legal {
    display: flex;
    gap: 1.25rem;
    max-width: 64rem;
    margin: 3rem auto 2rem;
    padding: 0.75rem 1rem 0;
    border-top: 1px solid #ddd;
    font-size: 0.85rem;
    color: #666;
  }
</style>
