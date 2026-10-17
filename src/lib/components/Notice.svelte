<script lang="ts">
	import type { Snippet } from 'svelte';
	import { IconCheck, IconFlag, IconHourglass } from '$lib/icons';

	/**
	 * A flat status message: tint, icon and text together, so it never relies on colour alone.
	 * `alert` interrupts (errors), `status` is polite (results, warnings).
	 */
	let {
		kind,
		role,
		id,
		children
	}: {
		kind: 'ok' | 'warn' | 'error';
		role: 'status' | 'alert';
		id?: string;
		children: Snippet;
	} = $props();
</script>

<div class="notice {kind}" {role} {id}>
	<span class="icon">
		{#if kind === 'ok'}<IconCheck size={20} />{:else if kind === 'warn'}<IconHourglass size={20} />{:else}<IconFlag size={20} />{/if}
	</span>
	<div class="text">{@render children()}</div>
</div>

<style>
	.notice {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-3);
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--r-ctl);
		font-size: var(--fs-ui);
		line-height: 1.4;
	}
	.icon {
		display: inline-flex;
		flex: none;
		padding-top: 1px;
	}
	.text {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.text :global(p) {
		max-width: none;
	}
	.ok {
		background: var(--accent-wash);
		color: var(--accent-ink);
	}
	.warn {
		background: var(--pending-wash);
		color: var(--pending-ink);
	}
	.error {
		background: var(--danger-wash);
		color: var(--danger);
	}
</style>
