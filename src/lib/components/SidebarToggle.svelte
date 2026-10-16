<script lang="ts">
	import { IconCaretLeft, IconCaretRight } from '$lib/icons';
	import type { NavState } from '$lib/nav';

	/**
	 * Collapse/expand button. A real form POST so it works without JavaScript; with JavaScript the
	 * state flips immediately (`onflip`) and a plain fetch stores the cookie. If that fails the
	 * flip is rolled back, and a redirect (expired session) goes where the server sent us.
	 */
	let { state, onflip }: { state: NavState; onflip: (next: NavState) => void } = $props();

	const next = $derived<NavState>(state === 'expanded' ? 'collapsed' : 'expanded');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const previous = state;
		const target = next;
		onflip(target);
		try {
			const res = await fetch('/preferences/nav', {
				method: 'POST',
				headers: { accept: 'application/json' },
				body: new URLSearchParams({ state: target })
			});
			if (res.redirected) {
				onflip(previous);
				window.location.assign(res.url); // e.g. the session expired: land on /login
				return;
			}
			if (!res.ok) onflip(previous);
		} catch {
			onflip(previous);
		}
	}
</script>

<form method="POST" action="/preferences/nav" onsubmit={submit}>
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
