<script lang="ts">
	import { barHeight, formatCount, niceMax } from '$lib/charts';

	type Series = { name: string; cls: 's0' | 's1' };
	type Point = { label: string; values: number[] };
	let {
		points,
		series,
		summary
	}: { points: Point[]; series: Series[]; summary: string } = $props();

	const H = 120;
	const BAR = 8;
	const GAP = 4;
	const group = $derived(series.length * BAR + GAP);
	const width = $derived(points.length * group);
	const axisMax = $derived(niceMax(Math.max(0, ...points.flatMap((p) => p.values))));
	const empty = $derived(points.every((p) => p.values.every((v) => v === 0)));
	// Keeps ~1 bar group per 14px on narrow screens; the container scrolls sideways.
	const minPx = $derived(Math.max(280, points.length * (series.length * 7 + 3)));
</script>

{#if empty}
	<p class="empty">No activity in this range</p>
{:else}
	<ul class="legend" aria-label="Legend">
		{#each series as s (s.name)}
			<li><span class="swatch {s.cls}" aria-hidden="true"></span>{s.name}</li>
		{/each}
	</ul>
	<div class="scroll">
		<div class="plot">
			<span class="axis-max">{formatCount(axisMax)}</span>
			<svg
				viewBox="0 0 {width} {H}"
				style="min-width: {minPx}px"
				role="img"
				aria-label={summary}
				preserveAspectRatio="none"
			>
				<line x1="0" x2={width} y1={H - 0.5} y2={H - 0.5} class="base" />
				<line x1="0" x2={width} y1="0.5" y2="0.5" class="grid" />
				{#each points as p, i (p.label)}
					{#each p.values as v, j (j)}
						{@const h = barHeight(v, axisMax, H)}
						<rect
							class={series[j].cls}
							x={i * group + j * BAR + GAP / 2}
							y={H - h}
							width={BAR - 1}
							height={h}
						>
							<title>{p.label}, {series[j].name}: {formatCount(v)}</title>
						</rect>
					{/each}
				{/each}
			</svg>
		</div>
		<div class="x-labels" aria-hidden="true">
			<span>{points[0].label}</span>
			<span>{points[points.length - 1].label}</span>
		</div>
	</div>
	<details>
		<summary>Show as table</summary>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Date</th>
						{#each series as s (s.name)}<th scope="col">{s.name}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each points as p (p.label)}
						<tr>
							<th scope="row">{p.label}</th>
							{#each p.values as v, j (j)}<td>{formatCount(v)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
{/if}

<style>
	.empty {
		margin: 1rem 0;
		color: #4b5563;
	}
	.scroll {
		overflow-x: auto;
	}
	.plot {
		position: relative;
		padding-left: 2.2rem;
	}
	.axis-max {
		position: absolute;
		left: 0;
		top: -0.4rem;
		font-size: 0.75rem;
		color: #4b5563;
	}
	svg {
		display: block;
		width: 100%;
		height: 7.5rem;
	}
	.base {
		stroke: #6b7280;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.grid {
		stroke: #d1d5db;
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
	.s0 {
		fill: #93c5fd;
		background: #93c5fd;
	}
	.s1 {
		fill: #1e3a8a;
		background: #1e3a8a;
	}
	.x-labels {
		display: flex;
		justify-content: space-between;
		padding-left: 2.2rem;
		font-size: 0.75rem;
		color: #4b5563;
	}
	.legend {
		display: flex;
		gap: 1rem;
		margin: 0 0 0.5rem;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}
	.swatch {
		display: inline-block;
		width: 0.8rem;
		height: 0.8rem;
		margin-right: 0.3rem;
		border: 1px solid #1e3a8a;
		vertical-align: middle;
	}
	details {
		margin-top: 0.5rem;
		font-size: 0.85rem;
	}
	table {
		border-collapse: collapse;
		margin-top: 0.5rem;
	}
	th,
	td {
		padding: 0.2rem 0.6rem;
		text-align: right;
		border-bottom: 1px solid #e5e7eb;
	}
	th[scope='row'],
	th:first-child {
		text-align: left;
	}
</style>
