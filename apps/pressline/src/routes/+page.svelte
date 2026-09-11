<script lang="ts">
  import { copy } from '$lib/copy';
</script>

<main class="home">
  <h1>{copy.home.title}</h1>
  <p>{copy.home.text}</p>
</main>

<style>
  .home {
    max-width: 40rem;
    margin: 3rem auto;
    padding: 0 1rem;
  }
</style>
