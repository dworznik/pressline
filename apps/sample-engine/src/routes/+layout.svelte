<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

{@render children()}

<footer class="powered">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="https://dworznik.github.io/pressline/" rel="noopener">Powered by Pressline</a>
</footer>

<style>
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
