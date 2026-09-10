<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const r = $derived(data.report);
  const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
</script>

<svelte:head><title>Operator · Reconciliation</title></svelte:head>

<h1>Reconciliation</h1>

<form method="POST" action="?/run" use:enhance>
  <button type="submit">Run now</button>
  {#if form?.message}<span class="warn">{form.message}</span>{/if}
</form>

{#if !r}
  <p>No run yet. Nightly runs are scheduled by the platform; you can also run one now.</p>
{:else}
  <p>
    Last run <strong>{when(r.finishedAt)}</strong> ({r.trigger}), took {r.finishedAt - r.startedAt} ms.
  </p>

  <section>
    <h2>Alarms ({r.alarms.length})</h2>
    {#if r.alarms.length === 0}
      <p>Nothing needs you.</p>
    {:else}
      <ul class="alarms">
        {#each r.alarms as a, i (i)}
          <li data-alarm={a.kind}>
            <strong>{a.kind}</strong>
            {#if a.orderId}
              <a href={resolve('/operator/orders/[id]', { id: a.orderId })}>{a.orderId}</a>
            {/if}
            {a.message}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>Steps</h2>
    <table>
      <thead><tr><th>Step</th><th>Checked</th><th>Repaired</th><th>Notes</th></tr></thead>
      <tbody>
        {#each Object.entries(r.steps) as [name, s] (name)}
          <tr data-step={name}>
            <td>{name}</td><td>{s.checked}</td><td>{s.repaired}</td>
            <td>
              {#each s.notes as n, i (i)}<div>{n}</div>{/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid #eee;
    vertical-align: top;
  }
  .alarms li {
    margin: 0.25rem 0;
  }
  .warn {
    color: #b00;
    margin-left: 0.75rem;
  }
</style>
