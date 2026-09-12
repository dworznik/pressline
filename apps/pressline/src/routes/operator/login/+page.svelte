<script lang="ts">
  import { enhance } from '$app/forms'
  import type { ActionData, PageData } from './$types'
  let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<svelte:head><title>Operator login</title></svelte:head>

<main class="login">
  <h1>Operator</h1>
  <form method="POST" use:enhance>
    <input type="hidden" name="next" value={data.next} />
    <label>
      Operator token
      <input type="password" name="token" autocomplete="off" required />
    </label>
    {#if form?.message}<p class="error">{form.message}</p>{/if}
    <button type="submit">Log in</button>
  </form>
</main>

<style>
  .login {
    max-width: 24rem;
    margin: 4rem auto;
  }
  label {
    display: block;
    margin-bottom: 1rem;
  }
  input {
    display: block;
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.25rem;
  }
  .error {
    color: #b00020;
  }
</style>
