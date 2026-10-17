<script lang="ts">
	import { IconCheck, IconClose, IconWarning } from '$lib/icons';

	type Level = 'ok' | 'attention' | 'critical';
	let {
		label,
		value,
		level,
		fraction,
		note
	}: {
		label: string;
		/** Always the text of the figure; the bar only repeats it. */
		value: string;
		/** When set, the row gets a status chip (icon and word) and the bar takes its colour. */
		level?: Level;
		/** 0 to 1, how full the bar is; no bar when omitted. */
		fraction?: number;
		note?: string;
	} = $props();

	const CHIP = {
		ok: { word: 'OK', cls: '', Icon: IconCheck },
		attention: { word: 'Attention', cls: 'chip-pending', Icon: IconWarning },
		critical: { word: 'Critical', cls: 'chip-danger', Icon: IconClose }
	} as const;
	const chip = $derived(level ? CHIP[level] : null);
	const pct = $derived(
		fraction === undefined || !Number.isFinite(fraction)
			? 0
			: Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10
	);
</script>

<li class="metric lv-{level ?? 'none'}">
	<span class="label">{label}</span>
	<span class="value num">{value}</span>
	{#if chip}
		<span class="chip {chip.cls}"><chip.Icon size={14} />{chip.word}</span>
	{/if}
	{#if fraction !== undefined}
		<span class="bar" aria-hidden="true" style="--fill: {pct}%"><i></i></span>
	{/if}
	{#if note}<span class="note">{note}</span>{/if}
</li>

<style>
	.metric {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px var(--sp-3);
		padding: var(--sp-3) var(--sp-4);
	}
	.label {
		grid-column: 1;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.value {
		grid-column: 1;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.chip {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
	}
	.bar {
		grid-column: 1 / -1;
		height: 6px;
		border-radius: 3px;
		background: var(--recess);
		overflow: hidden;
	}
	.bar i {
		display: block;
		width: var(--fill, 0%);
		height: 100%;
		border-radius: 3px;
		background: var(--accent);
	}
	.lv-attention .bar i {
		background: var(--pending);
	}
	.lv-critical .bar i {
		background: var(--danger);
	}
	.note {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: var(--fs-small);
	}

	@media (min-width: 900px) {
		.metric {
			grid-template-columns: 200px minmax(0, 1fr) auto;
			padding-inline: var(--sp-5);
		}
		.label,
		.value {
			grid-column: auto;
		}
		.chip {
			grid-column: 3;
			grid-row: 1;
		}
		.bar {
			grid-column: 2 / -1;
		}
		.note {
			grid-column: 2 / -1;
		}
	}
</style>
