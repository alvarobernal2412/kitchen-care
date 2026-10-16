<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatCount } from '$lib/charts';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import Heatmap from '$lib/components/charts/Heatmap.svelte';

	let { data } = $props();

	const day = (iso: string) => iso.slice(0, 10);
	const points = $derived(
		data.activity.map((a) => ({ label: a.bucket, values: [a.opens, a.submissions] }))
	);
	const summary = $derived(
		`Daily or weekly app opens and task submissions from ${day(data.from)} to ${day(data.to)}: ` +
			`${formatCount(data.totals.opens)} opens, ${formatCount(data.totals.submissions)} submissions.`
	);
	const maxCount = $derived(Math.max(1, ...data.distribution.map((d) => d.count)));
</script>

<svelte:head><title>Analytics</title></svelte:head>

<h2>Analytics</h2>

<form method="GET" action={resolve('/admin/analytics')} class="filters">
	<label>
		Range
		<select name="range" value={data.query.range}>
			<option value="7d">Last 7 days</option>
			<option value="30d">Last 30 days</option>
			<option value="period">Active period</option>
		</select>
	</label>
	<label>
		Group by
		<select name="bucket" value={data.query.bucket}>
			<option value="day">Day</option>
			<option value="week">Week</option>
		</select>
	</label>
	<label>
		Period
		<select name="periodId" value={data.periodId ?? ''} disabled={data.periods.length === 0}>
			{#each data.periods as p (p.id)}
				<option value={p.id}>{p.name}{p.active ? ' (active)' : ''}</option>
			{/each}
		</select>
	</label>
	<button type="submit">Apply</button>
</form>
<p class="muted">
	{day(data.from)} to {day(data.to)} &middot; times in {data.tz}
	{#if data.periodNote}&middot; no active period, showing the last 30 days{/if}
</p>

<dl class="tiles">
	<div><dt>App opens</dt><dd>{formatCount(data.totals.opens)}</dd></div>
	<div><dt>Active users</dt><dd>{formatCount(data.totals.activeUsers)}</dd></div>
	<div><dt>Submissions</dt><dd>{formatCount(data.totals.submissions)}</dd></div>
</dl>

<section>
	<h3>Activity</h3>
	<BarChart
		{points}
		series={[
			{ name: 'App opens', cls: 's0' },
			{ name: 'Submissions', cls: 's1' }
		]}
		{summary}
	/>
</section>

<section>
	<h3>When tasks get done</h3>
	<Heatmap matrix={data.heatmap} />
</section>

<section>
	<h3>Top contributors</h3>
	{#if data.contributors.length === 0}
		<p class="muted">No approved credits in this period yet.</p>
	{:else}
		<ol class="list">
			{#each data.contributors as c (c.userId)}
				<li>
					<span>{c.username}</span>
					<span class="muted">{formatCount(c.tasks)} {c.tasks === 1 ? 'task' : 'tasks'}</span>
					<strong>{formatCount(c.points)} pts</strong>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<section>
	<h3>Task distribution</h3>
	{#if data.periodId === null}
		<p class="muted">No period yet.</p>
	{:else}
		<ul class="list">
			{#each data.distribution as d (d.taskKey)}
				<li>
					<span>{d.label}</span>
					<span class="bar" aria-hidden="true"><i style="width: {(d.count / maxCount) * 100}%"></i></span>
					<strong>{formatCount(d.count)}</strong>
					<span class="muted">{formatCount(d.points)} pts</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
	}
	.filters label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	select {
		padding: 0.5rem;
		font: inherit;
	}
	.muted {
		color: #4b5563;
		font-size: 0.9rem;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.tiles div {
		padding: 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	dt {
		font-size: 0.8rem;
		color: #4b5563;
	}
	dd {
		margin: 0.2rem 0 0;
		font-size: 1.6rem;
		font-weight: 700;
	}
	section {
		margin-top: 1.5rem;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid #e5e7eb;
	}
	.list li > :first-child {
		flex: 1;
	}
	ol.list {
		counter-reset: rank;
	}
	ol.list li::before {
		counter-increment: rank;
		content: counter(rank);
		width: 1.4rem;
		color: #4b5563;
	}
	.bar {
		flex: 1;
		height: 0.6rem;
		background: #f3f4f6;
		border-radius: 3px;
	}
	.bar i {
		display: block;
		height: 100%;
		background: #1d4ed8;
		border-radius: 3px;
	}
</style>
