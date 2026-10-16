<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import '$lib/styles/legacy.css'; // interim shim, see the file

	let { data, children } = $props();
</script>

<AppShell
	isAdmin
	username={data.user.displayUsername}
	avatarPath={data.user.avatarPath}
	pendingCount={data.pendingCount}
	nav={data.nav}
	pathname={page.url.pathname}
>
	<!-- Legacy page width until each screen is restyled. -->
	<div class="legacy">
		{@render children()}
	</div>
</AppShell>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #f9fafb;
		color: #111827;
	}
	:global(button) {
		padding: 0.7rem 1rem;
		font: inherit;
		font-weight: 600;
		color: white;
		background: #1d4ed8;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	:global(button.danger) {
		background: #b91c1c;
	}
	:global(input[type='text']) {
		box-sizing: border-box;
		width: 100%;
		padding: 0.6rem;
		font: inherit;
	}
	.legacy {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1.5rem 0;
	}
</style>
