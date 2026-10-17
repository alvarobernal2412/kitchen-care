<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { avatarUrl } from '$lib/avatar';
	import { formatCount, seriesSummary } from '$lib/charts';
	import Avatar from '$lib/components/Avatar.svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import Heatmap from '$lib/components/charts/Heatmap.svelte';
	import Segmented from '$lib/components/Segmented.svelte';

	let { data } = $props();

	const day = (iso: string) => iso.slice(0, 10);
	const points = $derived(
		data.activity.map((a) => ({ label: a.bucket, values: [a.opens, a.submissions] }))
	);
	const userPoints = $derived(
		data.activity.map((a) => ({ label: a.bucket, values: [a.activeUsers] }))
	);
	const summary = $derived(
		seriesSummary(data.query.bucket, data.from, data.to, [
			{ name: 'app opens', total: data.totals.opens },
			{ name: 'task submissions', total: data.totals.submissions }
		])
	);
	const userSummary = $derived(
		seriesSummary(data.query.bucket, data.from, data.to, [
			{ name: 'distinct active users over the whole range', total: data.totals.activeUsers }
		]) + ' Each bar is the distinct users active in that period.'
	);
	const maxCount = $derived(Math.max(1, ...data.distribution.map((d) => d.count)));

	// An explicit choice of period (not the default active one) is kept when range or bucket change.
	const explicitPeriod = $derived(
		data.periodId !== null && !data.periods.find((p) => p.id === data.periodId)?.active
			? data.periodId
			: null
	);
	// Segmented resolves each href against the base path itself, so these stay unprefixed.
	function href(range: string, bucket: string): string {
		const q = new SvelteURLSearchParams({ range, bucket });
		if (explicitPeriod !== null) q.set('periodId', String(explicitPeriod));
		return `/admin/analytics?${q}`;
	}
	const ranges = $derived([
		{ value: '7d', label: 'Last 7 days', href: href('7d', data.query.bucket) },
		{ value: '30d', label: 'Last 30 days', href: href('30d', data.query.bucket) },
		{ value: 'period', label: 'Active period', href: href('period', data.query.bucket) }
	]);
	const buckets = $derived([
		{ value: 'day', label: 'Day', href: href(data.query.range, 'day') },
		{ value: 'week', label: 'Week', href: href(data.query.range, 'week') }
	]);
</script>

<svelte:head><title>Analytics</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Analytics</h1>
		<p class="sub">
			{day(data.from)} to {day(data.to)} &middot; times in {data.tz}
			{#if data.periodNote}&middot; no active period, showing the last 30 days{/if}
		</p>
	</header>

	<div class="controls">
		<div class="control">
			<p class="label" id="range-l">Date range</p>
			<Segmented options={ranges} value={data.query.range} name="range" ariaLabel="Date range" />
		</div>
		<div class="control narrow">
			<p class="label" id="bucket-l">Group by</p>
			<Segmented options={buckets} value={data.query.bucket} name="bucket" ariaLabel="Group by" />
		</div>
	</div>

	{#if data.periods.length > 0}
		<form method="GET" action={resolve('/admin/analytics')} class="period">
			<input type="hidden" name="range" value={data.query.range} />
			<input type="hidden" name="bucket" value={data.query.bucket} />
			<label class="label" for="a-period">Period for contributors and tasks</label>
			<div class="period-row">
				<select id="a-period" name="periodId" class="select" value={data.periodId ?? ''}>
					{#each data.periods as p (p.id)}
						<option value={p.id}>{p.name}{p.active ? ' (active)' : ''}</option>
					{/each}
				</select>
				<button type="submit" class="btn btn-quiet">Apply</button>
			</div>
		</form>
	{/if}

	<dl class="stats">
		<div><dt>App opens</dt><dd class="display num">{formatCount(data.totals.opens)}</dd></div>
		<div><dt>Active users</dt><dd class="display num">{formatCount(data.totals.activeUsers)}</dd></div>
		<div><dt>Submissions</dt><dd class="display num">{formatCount(data.totals.submissions)}</dd></div>
	</dl>

	<section aria-labelledby="h-activity">
		<h2 id="h-activity">Activity</h2>
		<BarChart
			{points}
			series={[
				{ name: 'App opens', cls: 's0' },
				{ name: 'Submissions', cls: 's1' }
			]}
			{summary}
		/>
	</section>

	<section aria-labelledby="h-users">
		<h2 id="h-users">Active users</h2>
		<BarChart points={userPoints} series={[{ name: 'Active users', cls: 's1' }]} summary={userSummary} />
	</section>

	<section aria-labelledby="h-heat">
		<h2 id="h-heat">When tasks get done</h2>
		<Heatmap matrix={data.heatmap} />
	</section>

	<div class="pair">
		<section aria-labelledby="h-top">
			<h2 id="h-top">Top contributors</h2>
			{#if data.contributors.length === 0}
				<p class="empty">No approved credits in this period yet.</p>
			{:else}
				<ol class="list">
					{#each data.contributors as c (c.userId)}
						<li class="contrib">
							<Avatar name={c.username} src={avatarUrl(c.avatarPath)} seed={c.userId} size={32} />
							<span class="cname">{c.username}</span>
							<span class="muted">{formatCount(c.tasks)} {c.tasks === 1 ? 'task' : 'tasks'}</span>
							<strong class="num">{formatCount(c.points)} pts</strong>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section aria-labelledby="h-dist">
			<h2 id="h-dist">Task distribution</h2>
			{#if data.periodId === null}
				<p class="empty">No period yet.</p>
			{:else}
				<ul class="list">
					{#each data.distribution as d (d.taskKey)}
						<li class="dist">
							<span class="dlabel">{d.label}</span>
							<span class="dnums"><strong class="num">{formatCount(d.count)}</strong> <span class="muted">{formatCount(d.points)} pts</span></span>
							<span class="bar" aria-hidden="true"><i style="width: {(d.count / maxCount) * 100}%"></i></span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

<style>
	.controls {
		display: grid;
		gap: var(--sp-3);
	}
	.control .label {
		margin-bottom: 6px;
		color: var(--muted);
		font-size: 13px;
		font-weight: 400;
	}
	.period {
		margin-top: var(--sp-4);
	}
	.period-row {
		display: flex;
		gap: var(--sp-2);
		margin-top: 6px;
	}
	.period-row .select {
		flex: 1;
		min-width: 0;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: var(--sp-6) 0 var(--sp-3);
		border-top: 2px solid var(--accent);
	}
	.stats div {
		padding: var(--sp-3) var(--sp-3) 0 0;
	}
	.stats div + div {
		padding-left: var(--sp-3);
		border-left: 1px solid var(--line);
	}
	dt {
		color: var(--muted);
		font-size: var(--fs-small);
	}
	dd {
		margin: 2px 0 0;
		font-size: clamp(24px, 7vw, 32px);
		overflow-wrap: anywhere;
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.03em;
	}

	section {
		margin-top: var(--sp-6);
	}
	section h2 {
		margin-bottom: var(--sp-3);
	}
	.pair {
		display: grid;
		gap: 0;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--line);
	}
	.list li {
		border-bottom: 1px solid var(--line);
	}
	.contrib {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--sp-3);
		min-height: 56px;
	}
	.cname {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.dist {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 6px var(--sp-3);
		padding: var(--sp-3) 0;
	}
	.dlabel {
		overflow-wrap: anywhere;
	}
	.dnums {
		display: inline-flex;
		gap: var(--sp-2);
		align-items: baseline;
	}
	.bar {
		grid-column: 1 / -1;
		height: 8px;
		border-radius: 4px;
		background: var(--recess);
	}
	.bar i {
		display: block;
		height: 100%;
		border-radius: 4px;
		background: var(--chart-2);
	}

	@media (min-width: 900px) {
		.controls {
			grid-template-columns: minmax(0, 420px) minmax(0, 200px);
			gap: var(--sp-5);
		}
		.period {
			max-width: 420px;
		}
		dd {
			font-size: 44px;
		}
		.pair {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0 var(--sp-7);
		}
	}
</style>
