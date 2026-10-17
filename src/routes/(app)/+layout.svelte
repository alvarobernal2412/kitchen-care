<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';
	import { usesShell } from '$lib/onboarding';

	let { data, children } = $props();
</script>

{#if usesShell(page.url.pathname)}
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
{:else}
	<!-- First-run flow: no navigation, just the skip link and the main landmark. -->
	<a class="skip-link" href="#main">Skip to content</a>
	<main id="main" tabindex="-1">
		{@render children()}
	</main>
{/if}

<style>
	/* The design tokens own the page colours and font (base.css); only the margin reset stays here. */
	:global(body) {
		margin: 0;
	}
	main {
		min-height: 100dvh;
		padding-inline: var(--gutter);
	}
	main:focus {
		outline: none;
	}
	.skip-link {
		position: fixed;
		top: var(--sp-2);
		left: var(--sp-2);
		z-index: var(--z-skip);
		padding: var(--sp-3) var(--sp-4);
		background: var(--surface);
		color: var(--accent-ink);
		font-weight: 600;
		border: 2px solid var(--accent);
		border-radius: var(--r-ctl);
		transform: translateY(-200%);
	}
	.skip-link:focus {
		transform: none;
	}
</style>
