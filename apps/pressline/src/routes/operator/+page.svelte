<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const h = $derived(data.health);
</script>

<svelte:head><title>Operator · Health</title></svelte:head>

<h1>Instance health</h1>

<section>
  <h2>Engines</h2>
  <table>
    <thead><tr><th>Engine</th><th>Status</th><th>Protocol</th><th>Reason</th></tr></thead>
    <tbody>
      {#each h.engines as e (e.slug)}
        <tr data-engine={e.slug} data-enabled={e.enabled}>
          <td>{e.slug}</td><td>{e.enabled ? 'enabled' : 'disabled'}</td><td
            >{e.protocolVersion ?? '—'}</td
          ><td>{e.reason ?? ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h2>Webhooks</h2>
  <ul>
    <li>
      Stripe: {h.webhooks.stripe.configured
        ? `registered at ${h.webhooks.stripe.url}`
        : `not registered (${h.webhooks.stripe.detail ?? ''})`}
    </li>
    <li>
      Printful: {h.webhooks.printful.configured
        ? `registered at ${h.webhooks.printful.url}`
        : `not registered (${h.webhooks.printful.detail ?? ''})`}
    </li>
  </ul>
  {#if !h.webhooks.stripe.configured || !h.webhooks.printful.configured}
    <p class="warn">Run <code>pressline webhooks register</code> against this instance.</p>
  {/if}
</section>

<section>
  <h2>Configuration</h2>
  <dl>
    <dt>Shop</dt>
    <dd>{h.config.name}</dd>
    <dt>Currency</dt>
    <dd>{h.config.currency}</dd>
    <dt>Offers</dt>
    <dd>{h.config.offers}</dd>
    <dt>Demo Mode</dt>
    <dd>{h.config.demo ? 'on' : 'off'}</dd>
    <dt>Mailer</dt>
    <dd>{h.config.mailer}</dd>
    <dt>Schema</dt>
    <dd>v{h.schema.version} of {h.schema.latest}</dd>
  </dl>
</section>

<section>
  <h2>Orders by state</h2>
  <dl>
    {#each Object.entries(h.counts) as [state, n] (state)}
      <dt>{state}</dt>
      <dd>{n}</dd>
    {/each}
  </dl>
</section>

<style>
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #eee;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
  }
  dd {
    margin: 0;
  }
  .warn {
    color: #8a5a00;
  }
</style>
