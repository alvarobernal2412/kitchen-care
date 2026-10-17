<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '$lib/components/AppShell.svelte';

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
	{@render children()}
</AppShell>
