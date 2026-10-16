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
	title={mounted ? new Date(iso).toLocaleString() : undefined}
>
	{mounted ? timeAgo(iso, now) : fixed}
</time>
