<script lang="ts">
  import { page } from '$app/state';
</script>

<main class="error">
  <h1>{page.status}</h1>
  <p>{page.error?.message ?? 'Something went wrong.'}</p>
</main>

<style>
  .error {
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1rem;
    text-align: center;
  }
</style>
