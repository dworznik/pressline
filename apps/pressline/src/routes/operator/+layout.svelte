<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  const onLogin = $derived(page.url.pathname === '/operator/login');
</script>

<div class="operator">
  {#if !onLogin}
    <nav>
      <a href={resolve('/operator')}>Health</a>
      <a href={resolve('/operator/orders')}>Orders</a>
      <a href={resolve('/operator/reconciliation')}>Reconciliation</a>
      {#if data.demo}
        <span class="demo" data-demo>Demo Mode: this view is public and read-only</span>
      {:else}
        <form method="POST" action={resolve('/operator/logout')}>
          <button type="submit">Log out</button>
        </form>
      {/if}
    </nav>
  {/if}
  {@render children()}
</div>

<style>
  .operator {
    max-width: 72rem;
    margin: 1.5rem auto;
    padding: 0 1rem;
    font-size: 0.95rem;
  }
  nav {
    display: flex;
    gap: 1rem;
    align-items: center;
    border-bottom: 1px solid #ddd;
    padding-bottom: 0.75rem;
    margin-bottom: 1.5rem;
  }
  nav form,
  nav .demo {
    margin-left: auto;
  }
  nav .demo {
    font-size: 0.85rem;
    color: #7a5b00;
  }
</style>
