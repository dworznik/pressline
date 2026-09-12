<script lang="ts">
  import { enhance } from '$app/forms'
  import { toSvg, type Template } from '$lib/template'
  import type { ActionData, PageData } from './$types'

  let { data, form }: { data: PageData; form: ActionData } = $props()
  let t = $state<Template>({ ...data.template })
  // The background is either transparent (the garment shows through) or a color the picker holds.
  let transparent = $state(data.template.background === 'none')
  let backgroundColor = $state(
    data.template.background === 'none' ? '#0a7d5a' : data.template.background,
  )
  const template = $derived<Template>({
    ...t,
    background: transparent ? 'none' : backgroundColor,
  })
  // Shown as an image, never injected as markup: the browser treats it as a picture only.
  const preview = $derived(`data:image/svg+xml,${encodeURIComponent(toSvg(template))}`)
</script>

<svelte:head><title>Sample Engine · Design something</title></svelte:head>

<main class="designer">
  <section class="canvas">
    <img src={preview} alt="Your design" />
  </section>
  <form method="POST" action="?/finalize" use:enhance class="controls">
    <h1>Design something</h1>
    <label>Text <input name="text" bind:value={t.text} maxlength="40" /></label>
    <label>Text color <input type="color" name="textColor" bind:value={t.textColor} /></label>
    <label class="check">
      <input type="checkbox" name="transparent" bind:checked={transparent} /> No background (the garment
      shows through)
    </label>
    {#if !transparent}
      <label>Background <input type="color" name="background" bind:value={backgroundColor} /></label
      >
    {/if}
    <label>
      Shape
      <select name="shape" bind:value={t.shape}>
        <option value="circle">Circle</option>
        <option value="square">Square</option>
        <option value="triangle">Triangle</option>
        <option value="none">None</option>
      </select>
    </label>
    <label>Shape color <input type="color" name="shapeColor" bind:value={t.shapeColor} /></label>
    <button type="submit">Finalize</button>
    <p class="hint">
      Finalizing stores your design and renders the print files for every product
      {data.pressline ? 'in the shop' : '(no Pressline instance configured yet)'}.
    </p>
  </form>
  {#if data.ai}
    <form method="POST" action="?/generate" use:enhance class="ai">
      <h2>…or describe it</h2>
      <input name="prompt" placeholder="A watercolor heron at dawn" maxlength="500" />
      <button type="submit">Generate</button>
    </form>
  {/if}
  {#if form?.message}<p class="error">{form.message}</p>{/if}
</main>

<style>
  .designer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20rem;
    gap: 2rem;
    max-width: 64rem;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
  }
  .canvas img {
    width: 100%;
    height: auto;
    border-radius: 0.5rem;
    /* A light backdrop, so a transparent design still shows its edges. */
    background: #f1f1f1;
  }
  .check input {
    width: auto;
    margin-right: 0.4rem;
  }
  label {
    display: block;
    margin-bottom: 0.75rem;
  }
  input[type='text'],
  input:not([type]) {
    width: 100%;
  }
  .hint,
  .error {
    font-size: 0.85rem;
    color: #555;
  }
  .error {
    color: #b00;
  }
</style>
