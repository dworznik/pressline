<script lang="ts">
  import { resolve } from '$app/paths'
  import type { Snippet } from 'svelte'
  let { children }: { children: Snippet } = $props()
</script>

<header class="top">
  <a href={resolve('/')} class="home">Sample Engine</a>
  <span class="hint">Design something, then order a print.</span>
</header>

{@render children()}

<footer class="powered">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="https://dworznik.github.io/pressline/" target="_blank" rel="noopener"
    >Powered by Pressline</a
  >
</footer>

<style>
  .top {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    max-width: 64rem;
    margin: 1rem auto 0;
    padding: 0 1rem 0.75rem;
    border-bottom: 3px solid #222;
    font-family: system-ui, sans-serif;
  }
  .home {
    font-weight: 700;
    color: #222;
    text-decoration: none;
  }
  .hint {
    font-size: 0.85rem;
    color: #666;
  }
  .powered {
    max-width: 64rem;
    margin: 2rem auto 1.5rem;
    padding: 0 1rem;
    text-align: center;
    font-family: system-ui, sans-serif;
    font-size: 0.8rem;
  }
  .powered a {
    color: #666;
  }
</style>
