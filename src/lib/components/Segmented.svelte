<script lang="ts">
	import { resolve } from '$app/paths';

	type Option = { value: string; label: string; href?: string };

	/**
	 * Segmented control. When every option has an `href` it is a `<nav>` of links (works without
	 * JavaScript; hrefs are app-internal paths, resolved against the base path); otherwise a radio group that calls `onchange(value)`.
	 */
	let {
		options,
		value,
		name,
		ariaLabel,
		required = false,
		onchange
	}: {
		options: Option[];
		value: string;
		name: string;
		ariaLabel: string;
		required?: boolean;
		onchange?: (value: string) => void;
	} = $props();

	const linkMode = $derived(options.length > 0 && options.every((o) => o.href));
</script>

{#if linkMode}
	<nav class="seg" aria-label={ariaLabel}>
		{#each options as o (o.value)}
			<a
				class="seg-item"
				href={resolve(o.href as '/')}
				aria-current={o.value === value ? 'page' : undefined}
				data-sveltekit-noscroll>{o.label}</a
			>
		{/each}
	</nav>
{:else}
	<div class="seg" role="radiogroup" aria-label={ariaLabel}>
		{#each options as o (o.value)}
			<label class="seg-item" class:active={o.value === value}>
				<input
					class="seg-input"
					type="radio"
					{name}
					{required}
					value={o.value}
					checked={o.value === value}
					onchange={() => onchange?.(o.value)}
				/>
				{o.label}
			</label>
		{/each}
	</div>
{/if}
