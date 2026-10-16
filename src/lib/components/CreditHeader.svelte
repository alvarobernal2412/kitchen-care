<script lang="ts">
	import { ordinal } from '$lib/ordinal';

	let {
		periodName,
		total,
		shown,
		standing,
		ready = [],
		totalEl = $bindable()
	}: {
		periodName: string;
		/** The real total (what assistive tech reads). */
		total: number;
		/** The number on screen; differs from `total` only while the count-up runs. */
		shown: number;
		standing: { rank: number | null; ofTotal: number; behindFirst: number; leaders: number };
		/** Plain-words names of the chores that can be logged right now. */
		ready?: string[];
		/** The big number, so the page can fly +N to it. */
		totalEl?: HTMLElement;
	} = $props();

	const gap = $derived(standing.behindFirst);
	const readyParts = $derived.by(() => {
		if (ready.length === 0) return null;
		const cap = (s: string, first: boolean) => (first ? s[0].toUpperCase() + s.slice(1) : s);
		const names = ready.map((n, i) => ({ text: cap(n, i === 0), key: n }));
		return { names, verb: ready.length === 1 ? 'is' : 'are' };
	});
</script>

<header class="credit">
	<p class="period">{periodName}</p>
	<div class="total">
		<span class="visually-hidden">{total} {total === 1 ? 'credit' : 'credits'}</span>
		<span class="hero" data-testid="credit-total" aria-hidden="true" bind:this={totalEl}>{shown}</span>
		<span class="unit" aria-hidden="true">{total === 1 ? 'credit' : 'credits'}</span>
	</div>
	<div class="rank">
		{#if standing.rank === null}
			<b>Not ranked</b>
		{:else}
			<b data-testid="rank">{ordinal(standing.rank)} of {standing.ofTotal}</b>
		{/if}
		<span>your rank</span>
	</div>
	<p class="status" data-testid="status">
		{#if standing.rank === null}
			Log your first chore to join the board.
		{:else if standing.behindFirst === 0 && standing.leaders > 1}
			You share first place.
		{:else if standing.behindFirst === 0}
			You are in first place.
		{:else}
			You are {gap} {gap === 1 ? 'credit' : 'credits'} behind first place.
		{/if}
		{#if readyParts}
			{#each readyParts.names as n, i (n.key)}{#if i > 0}{i === readyParts.names.length - 1 ? ' and ' : ', '}{/if}<i>{n.text}</i>{/each}
			{readyParts.verb} ready to log.
		{/if}
	</p>
</header>

<style>
	.credit {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: var(--sp-1) var(--sp-4);
		padding-top: var(--sp-5);
	}
	.period {
		grid-column: 1 / -1;
		max-width: none;
		font-size: 14px;
		font-weight: 500;
		color: var(--muted);
	}
	.total {
		display: flex;
		align-items: baseline;
		gap: var(--sp-2);
		min-width: 0;
	}
	.hero {
		/* fluid so a four-digit total never forces horizontal scroll */
		font: 800 clamp(48px, 17vw, var(--fs-hero)) / 0.9 var(--font-display);
		letter-spacing: -0.03em;
	}
	.unit {
		font: 600 20px / 1 var(--font-display);
		letter-spacing: -0.01em;
		color: var(--muted);
	}
	.rank {
		text-align: right;
		padding-bottom: 4px;
	}
	.rank b {
		display: block;
		font: 700 24px / 1 var(--font-display);
		letter-spacing: -0.02em;
	}
	.rank span {
		font-size: var(--fs-small);
		color: var(--muted);
	}
	.status {
		grid-column: 1 / -1;
		margin-top: var(--sp-3);
		font-size: var(--fs-ui);
		line-height: 1.5;
		max-width: 46ch;
	}
	.status i {
		font-style: normal;
		font-weight: 600;
		color: var(--accent-ink);
	}

	@media (min-width: 900px) {
		.credit {
			grid-template-columns: auto minmax(0, 1fr);
			gap: var(--sp-1) var(--sp-7);
			padding-top: var(--sp-6);
		}
		.hero {
			font-size: 96px;
		}
		.rank {
			text-align: left;
		}
	}
</style>
