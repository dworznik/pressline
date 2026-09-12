<script lang="ts">
  import { page } from '$app/state'
  import { copy } from '$lib/copy'
</script>

<main class="error">
  <h1>{page.status}</h1>
  <p>{page.error?.message ?? copy.error.fallback}</p>
</main>

<style>
  .error {
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1rem;
    text-align: center;
  }
</style>
