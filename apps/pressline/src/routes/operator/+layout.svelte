<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  let { children } = $props();
  const onLogin = $derived(page.url.pathname === '/operator/login');
</script>

<div class="operator">
  {#if !onLogin}
    <nav>
      <a href={resolve('/operator')}>Health</a>
      <a href={resolve('/operator/orders')}>Orders</a>
      <form method="POST" action={resolve('/operator/logout')}>
        <button type="submit">Log out</button>
      </form>
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
  nav form {
    margin-left: auto;
  }
</style>
