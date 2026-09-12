<script lang="ts">
  import { resolve } from '$app/paths'
  import { formatMoney } from '$lib/money'
  import type { PageData } from './$types'
  let { data }: { data: PageData } = $props()
  const states = [
    '',
    'checkout_open',
    'paid',
    'submit_failed',
    'submitted',
    'on_hold',
    'in_production',
    'shipped',
    'fulfilled',
    'canceled',
    'refunded',
    'expired',
  ]
  const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
</script>

<svelte:head><title>Operator · Orders</title></svelte:head>

<h1>Orders</h1>
<form method="GET" class="filter">
  <label
    >State
    <select
      name="state"
      onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
    >
      {#each states as s (s)}<option value={s} selected={s === data.state}>{s || 'all'}</option
        >{/each}
    </select>
  </label>
</form>

<table>
  <thead
    ><tr
      ><th>Created</th><th>Order</th><th>State</th><th>Offer</th><th>Country</th><th>Total</th></tr
    ></thead
  >
  <tbody>
    {#each data.list.orders as o (o.id)}
      <tr data-order={o.id}>
        <td>{when(o.createdAt)}</td>
        <td
          ><a href={resolve('/operator/orders/[id]', { id: o.id })}><code>{o.id.slice(-8)}</code></a
          ></td
        >
        <td>{o.state}</td>
        <td>{o.offer} / {o.variant}</td>
        <td>{o.country}</td>
        <td>{formatMoney(o.amountTotal ?? o.retail + o.shipping, o.currency)}</td>
      </tr>
    {:else}
      <tr><td colspan="6">No orders{data.state ? ` in ${data.state}` : ''}.</td></tr>
    {/each}
  </tbody>
</table>
{#if data.list.nextCursor}
  <p>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href={`?state=${encodeURIComponent(data.state)}&before=${data.list.nextCursor}`}>Older →</a>
  </p>
{/if}

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
  .filter {
    margin-bottom: 1rem;
  }
</style>
