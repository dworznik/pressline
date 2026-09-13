<script lang="ts">
  import { describeHeader } from '@pressline/contract'
  import { formatMoney } from '$lib/money'
  import type { PageData } from './$types'
  let { data }: { data: PageData } = $props()
  const d = $derived(data.detail)
  const o = $derived(data.detail.order)
  const inspection = $derived(data.detail.order.printfile.inspection)
  const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  const money = (n: number) => formatMoney(n, o.currency)
</script>

<svelte:head><title>Operator · Order {o.id.slice(-8)}</title></svelte:head>

<h1>Order <code>{o.id}</code> <span class="state" data-state={o.state}>{o.state}</span></h1>

<div class="grid">
  <section>
    <h2>Item</h2>
    <dl>
      <dt>Engine / design</dt>
      <dd>{o.engine} / {o.designId}</dd>
      <dt>Offer / variant</dt>
      <dd>{o.offer} / {o.variant}</dd>
      <dt>Printfile</dt>
      <dd>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href={o.printfile.url} rel="noopener noreferrer">{o.printfile.contentType}</a> · {o.specHash.slice(
          0,
          12,
        )}…
        <!-- What Validation concluded at sale (#87). Deviations are recorded and
             shown, never an Alarm: the file was sellable, and it sold. -->
        {#if !inspection}
          <div class="quiet">no Inspection recorded</div>
        {:else}
          {#if inspection.header}<div class="quiet">{describeHeader(inspection.header)}</div>{/if}
          {#each inspection.deviations as d (d.code)}
            <div class="deviation">⚠ {d.code}: {d.message}</div>
          {/each}
        {/if}
      </dd>
      <dt>Retail + shipping</dt>
      <dd>{money(o.retail)} + {money(o.shipping)} ({o.shippingMethod.name})</dd>
      <dt>Tax / total charged</dt>
      <dd>
        {o.amountTax !== undefined ? money(o.amountTax) : '—'} / {o.amountTotal !== undefined
          ? money(o.amountTotal)
          : '—'}
      </dd>
      <dt>Provider cost estimate</dt>
      <dd>{money(o.providerCostEstimate.product)} + {money(o.providerCostEstimate.shipping)}</dd>
    </dl>
  </section>

  <section>
    <h2>Recipient</h2>
    {#if o.purgedAt}
      <p>Personal data purged {when(o.purgedAt)}.</p>
    {:else if o.recipient}
      <address>
        {o.recipient.name}<br />{o.recipient.address1}{#if o.recipient.address2}<br />{o.recipient
            .address2}{/if}<br />
        {o.recipient.zip ?? ''}
        {o.recipient.city}{o.recipient.state ? `, ${o.recipient.state}` : ''}, {o.recipient
          .country}<br />
        {o.recipient.email}{#if o.recipient.phone}
          · {o.recipient.phone}{/if}
      </address>
    {:else}
      <p>Not collected yet.</p>
    {/if}
    <h2>Links</h2>
    <ul>
      {#if d.links.stripePayment}<li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={d.links.stripePayment} rel="noopener noreferrer">Stripe payment</a>
        </li>{/if}
      {#if d.links.stripeSession}<li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={d.links.stripeSession} rel="noopener noreferrer">Stripe checkout session</a>
        </li>{/if}
      {#if d.links.printfulOrder}<li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={d.links.printfulOrder} rel="noopener noreferrer"
            >Printful order {o.providerOrderId}</a
          >
        </li>{/if}
      {#if o.tracking?.url}<li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={o.tracking.url} rel="noopener noreferrer">Tracking {o.tracking.number ?? ''}</a>
        </li>{/if}
    </ul>
  </section>
</div>

<section>
  <h2>Transitions</h2>
  <table>
    <thead
      ><tr><th>When</th><th>From → to</th><th>Cause</th><th>Reference</th><th>Note</th></tr></thead
    >
    <tbody>
      {#each d.transitions as t (t.id)}
        <tr
          ><td>{when(t.at)}</td><td>{t.from ?? '∅'} → {t.to}</td><td>{t.cause}</td><td
            ><code>{t.causeRef ?? ''}</code></td
          ><td>{t.note ?? ''}</td></tr
        >
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h2>Inbound events</h2>
  {#if d.inboundEvents.length === 0}<p>None yet.</p>{:else}
    <table>
      <thead
        ><tr><th>Received</th><th>Provider</th><th>Type</th><th>Outcome</th><th>Note</th></tr
        ></thead
      >
      <tbody>
        {#each d.inboundEvents as e (e.provider + e.eventId)}
          <tr
            ><td>{when(e.receivedAt)}</td><td>{e.provider}</td><td>{e.eventType}</td><td
              >{e.outcome ?? 'pending'}</td
            ><td>{e.note ?? ''}</td></tr
          >
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section>
  <h2>Emails</h2>
  {#if d.emails.length === 0}<p>None yet.</p>{:else}
    <ul>
      {#each d.emails as e (e.kind)}
        <li>
          {e.kind}: {e.sentAt
            ? `sent ${when(e.sentAt)}`
            : `not sent (${e.attempts} attempts${e.lastError ? `: ${e.lastError}` : ''})`}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
  }
  dd {
    margin: 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #eee;
    vertical-align: top;
  }
  .state {
    font-size: 0.8rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    background: #eee;
  }
  address {
    font-style: normal;
  }
  .quiet {
    color: #666;
    font-size: 0.85rem;
  }
  .deviation {
    font-size: 0.85rem;
  }
</style>
