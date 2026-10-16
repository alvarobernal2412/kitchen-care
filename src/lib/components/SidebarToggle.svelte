<script lang="ts">
	import { enhance } from '$app/forms';
	import { IconCaretLeft, IconCaretRight } from '$lib/icons';
	import type { NavState } from '$lib/nav';

	/**
	 * Collapse/expand button. A real form POST so it works without JavaScript; with JavaScript the
	 * state flips immediately (`onflip`) and the request only stores the cookie.
	 */
	let { state, onflip }: { state: NavState; onflip: (next: NavState) => void } = $props();

	const next = $derived<NavState>(state === 'expanded' ? 'collapsed' : 'expanded');
</script>

<form
	method="POST"
	action="/preferences/nav"
	use:enhance={() => {
		onflip(next);
		// The cookie is stored by the server; nothing to reload.
		return async () => {};
	}}
>
	<input type="hidden" name="state" value={next} />
	<button
		type="submit"
		class="toggle"
		aria-expanded={state === 'expanded'}
		aria-controls="sidebar"
	>
		{#if state === 'expanded'}
			<IconCaretLeft size={20} />
			<span class="text">Collapse sidebar</span>
		{:else}
			<IconCaretRight size={20} />
			<span class="visually-hidden">Expand sidebar</span>
		{/if}
	</button>
</form>

<style>
	.toggle {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		width: 100%;
		min-height: 44px;
		min-width: 44px;
		padding: 0 var(--sp-3);
		background: transparent;
		border: 0;
		border-radius: var(--r-ctl);
		color: var(--muted);
		font-size: var(--fs-ui);
		font-weight: 500;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.toggle:hover {
		background: var(--recess);
		color: var(--ink);
	}
	/* 44px target centred in the 72px rail */
	:global([data-nav='collapsed']) .toggle {
		justify-content: center;
		padding: 0;
	}
</style>
