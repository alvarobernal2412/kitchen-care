<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import '$lib/styles/legacy.css'; // interim shim, see the file

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
	<!-- Legacy page width until each screen is restyled (Home is done). -->
	<div class:legacy={page.url.pathname !== '/'}>
		{@render children()}
	</div>
</AppShell>

<style>
	/* The design tokens own the page colours and font (base.css); only the margin reset stays here. */
	:global(body) {
		margin: 0;
	}
	:global(button) {
		width: 100%;
		padding: 0.8rem;
		font: inherit;
		font-weight: 600;
		color: white;
		background: #1d4ed8;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	:global(button:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.legacy {
		max-width: 24rem;
		margin: 0 auto;
		padding: 1.5rem 0;
	}
</style>
