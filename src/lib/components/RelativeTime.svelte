<script lang="ts">
	import { onMount } from 'svelte';
	import { timeAgo } from '$lib/relativeTime';

	let { iso, class: className = '' }: { iso: string; class?: string } = $props();

	// The server and the first client render show the same fixed UTC date (no hydration mismatch,
	// and a sensible label without JavaScript); relative wording and the local exact time
	// replace it once mounted.
	const fixed = $derived(
		new Date(iso).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		})
	);
	// Hover text: the exact UTC time from the server (so it exists without JavaScript), the viewer's
	// local time once mounted.
	const utcTitle = $derived(
		`${new Date(iso).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'UTC'
		})} UTC`
	);
	let mounted = $state(false);
	let now = $state(0);
	onMount(() => {
		mounted = true;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});
</script>

<time
	class={className || undefined}
	datetime={iso}
	title={mounted ? new Date(iso).toLocaleString() : utcTitle}
>
	{mounted ? timeAgo(iso, now) : fixed}
</time>
