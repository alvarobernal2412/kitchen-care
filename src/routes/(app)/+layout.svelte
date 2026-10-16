<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';

	let { data, children } = $props();
</script>

<AppShell
	isAdmin={data.user.role === 'admin'}
	username={data.user.displayUsername}
	avatarPath={data.user.avatarPath}
	pendingCount={data.pendingCount}
	nav={data.nav}
	pathname={page.url.pathname}
>
	{@render children()}
</AppShell>

<style>
	/* The design tokens own the page colours and font (base.css); only the margin reset stays here. */
	:global(body) {
		margin: 0;
	}
	/* Default for bare <button>s (e.g. the camera overlay); restyled screens use .btn classes. */
	:global(button) {
		width: 100%;
		padding: 0.8rem;
		font: inherit;
		font-weight: 600;
		color: var(--on-accent);
		background: var(--accent);
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	:global(button:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
