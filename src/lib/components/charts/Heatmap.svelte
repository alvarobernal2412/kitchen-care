<script lang="ts">
	import { HEAT_STEPS, formatCount, intensityStep, isAllZero, matrixMax } from '$lib/charts';

	let { matrix }: { matrix: number[][] } = $props();

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const HOURS = [...Array(24).keys()];
	const max = $derived(matrixMax(matrix));
	const empty = $derived(isAllZero(matrix));
	const steps = Array.from({ length: HEAT_STEPS }, (_, i) => i);
</script>

{#if empty}
	<p class="empty">No activity in this range.</p>
{:else}
	<p class="legend">
		<span class="num">0</span>
		{#each steps as s (s)}<span class="swatch step{s}" aria-hidden="true"></span>{/each}
		<span class="num">{formatCount(max)} (max)</span>
	</p>
	<!-- Focusable so keyboard users can scroll the wide table sideways. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="scroll" role="region" aria-label="Submissions heatmap" tabindex="0">
		<table>
			<caption class="visually-hidden">Task submissions by weekday and hour of day</caption>
			<thead>
				<tr>
					<td></td>
					{#each HOURS as h (h)}
						<th scope="col">{h}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each matrix as row, d (d)}
					<tr>
						<th scope="row">{DAYS[d]}</th>
						{#each row as n, h (h)}
							<td class="step{intensityStep(n, max)}" title="{DAYS[d]} {h}:00, {formatCount(n)}">
								{n === 0 ? '' : formatCount(n)}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.empty {
		color: var(--muted);
	}
	.scroll {
		overflow-x: auto;
		border-radius: var(--r-ctl);
	}
	table {
		min-width: 34rem;
		width: 100%;
		border-collapse: separate;
		border-spacing: 2px;
		font-size: 12px;
		table-layout: fixed;
	}
	th {
		color: var(--muted);
		font-weight: 600;
	}
	th[scope='row'] {
		width: 2.6rem;
		text-align: left;
	}
	td {
		height: 28px;
		padding: 0;
		text-align: center;
		border-radius: 4px;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		margin: 0 0 var(--sp-3);
		max-width: none;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.swatch {
		display: inline-block;
		width: 24px;
		height: 16px;
		border-radius: 4px;
	}
	/* One teal hue, light to dark (dark to light in dark mode); step 0 is the empty cell. */
	.step0 {
		background: var(--recess);
		color: var(--ink);
	}
	.step1 {
		background: var(--heat-1);
		color: var(--ink);
	}
	.step2 {
		background: var(--heat-2);
		color: var(--ink);
	}
	.step3 {
		background: var(--heat-3);
		color: var(--on-accent);
	}
	.step4 {
		background: var(--heat-4);
		color: var(--on-accent);
	}
</style>
