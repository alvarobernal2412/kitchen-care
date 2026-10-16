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
	<p class="empty">No activity in this range</p>
{:else}
	<p class="legend" aria-hidden="true">
		<span>0</span>
		{#each steps as s (s)}<span class="swatch step{s}"></span>{/each}
		<span>{formatCount(max)} (max)</span>
	</p>
	<!-- Focusable so keyboard users can scroll the wide table sideways. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="scroll" role="region" aria-label="Submissions heatmap" tabindex="0">
		<table>
			<caption class="sr">Task submissions by weekday and hour of day</caption>
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
		margin: 1rem 0;
		color: #4b5563;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		min-width: 34rem;
		width: 100%;
		border-collapse: separate;
		border-spacing: 2px;
		font-size: 0.7rem;
		table-layout: fixed;
	}
	th {
		font-weight: 600;
		color: #374151;
	}
	th[scope='row'] {
		width: 2.4rem;
		text-align: left;
	}
	td {
		height: 1.6rem;
		padding: 0;
		text-align: center;
		border-radius: 3px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		color: #374151;
	}
	.swatch {
		display: inline-block;
		width: 1.4rem;
		height: 0.9rem;
		border-radius: 3px;
	}
	/* single-hue scale; text flips to white from step 3 for contrast */
	.step0 {
		background: #f3f4f6;
		color: #111827;
	}
	.step1 {
		background: #bfdbfe;
		color: #111827;
	}
	.step2 {
		background: #60a5fa;
		color: #111827;
	}
	.step3 {
		background: #1d4ed8;
		color: #ffffff;
	}
	.step4 {
		background: #1e3a8a;
		color: #ffffff;
	}
</style>
