<script lang="ts">
	import { formatCount, niceMax } from '$lib/charts';

	/**
	 * Grouped vertical bars drawn with plain boxes. `s0` is the lighter, hatched series and `s1` the
	 * solid one, so the two differ by pattern and tone and never by hue alone. The plot is one image
	 * for assistive tech (`summary`); "Show as table" lists every value.
	 */
	type Series = { name: string; cls: 's0' | 's1' };
	type Point = { label: string; values: number[] };
	let {
		points,
		series,
		summary
	}: { points: Point[]; series: Series[]; summary: string } = $props();

	const axisMax = $derived(niceMax(Math.max(0, ...points.flatMap((p) => p.values))));
	const empty = $derived(points.every((p) => p.values.every((v) => v === 0)));
	// About 14px per bar group, so a long range scrolls inside the chart instead of squeezing the bars.
	const minPx = $derived(Math.max(280, points.length * (series.length * 7 + 3)));
	const pct = (v: number) => (v > 0 ? `max(2px, ${(Math.min(v, axisMax) / axisMax) * 100}%)` : '0');
</script>

{#if empty}
	<p class="empty">No activity in this range.</p>
{:else}
	<ul class="legend" aria-label="Legend">
		{#each series as s (s.name)}
			<li><span class="swatch {s.cls}" aria-hidden="true"></span>{s.name}</li>
		{/each}
	</ul>
	<div class="scroll">
		<div class="frame" style="min-width: {minPx}px">
			<span class="axis-max num" aria-hidden="true">{formatCount(axisMax)}</span>
			<div class="plot" role="img" aria-label={summary}>
				{#each points as p (p.label)}
					<div class="group">
						{#each p.values as v, j (j)}
							<span
								class="bar {series[j].cls}"
								style:height={pct(v)}
								title="{p.label}, {series[j].name}: {formatCount(v)}"
							></span>
						{/each}
					</div>
				{/each}
			</div>
			<div class="x-labels" aria-hidden="true">
				<span>{points[0].label}</span>
				<span>{points[points.length - 1].label}</span>
			</div>
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
		color: var(--muted);
	}
	.scroll {
		overflow-x: auto;
	}
	.frame {
		position: relative;
		padding-top: var(--sp-5);
	}
	.axis-max {
		position: absolute;
		top: 0;
		left: 0;
		color: var(--muted);
		font-size: var(--fs-small);
		line-height: 1;
	}
	.plot {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 140px;
		border-bottom: 1px solid var(--muted);
		/* the dashed line marks the axis maximum */
		background: linear-gradient(to right, var(--line) 50%, transparent 0) top / 8px 1px repeat-x;
	}
	.group {
		display: flex;
		flex: 1;
		align-items: flex-end;
		gap: 1px;
		height: 100%;
		min-width: 0;
	}
	.bar {
		flex: 1;
		min-width: 0;
		border-radius: 2px 2px 0 0;
	}
	.s0 {
		background-color: var(--chart-1);
		background-image: repeating-linear-gradient(
			135deg,
			transparent 0 2px,
			var(--ground) 2px 3.5px
		);
	}
	.s1 {
		background-color: var(--chart-2);
	}
	.x-labels {
		display: flex;
		justify-content: space-between;
		margin-top: var(--sp-1);
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-1) var(--sp-4);
		margin: 0 0 var(--sp-3);
		padding: 0;
		list-style: none;
		font-size: var(--fs-ui);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 3px;
	}
	details {
		margin-top: var(--sp-3);
		font-size: var(--fs-ui);
	}
	summary {
		display: flex;
		align-items: center;
		min-height: 44px;
		color: var(--accent-ink);
		font-weight: 600;
		cursor: pointer;
	}
	table {
		border-collapse: collapse;
		font-size: var(--fs-small);
	}
	th,
	td {
		padding: 6px var(--sp-3);
		text-align: right;
		border-bottom: 1px solid var(--line);
	}
	th[scope='row'],
	th:first-child {
		text-align: left;
	}
</style>
