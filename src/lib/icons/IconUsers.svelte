<script lang="ts">
	let {
		size = 24,
		class: className = '',
		title
	}: { size?: number; class?: string; title?: string } = $props();
</script>

<svg
	class={className || undefined}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={title ? 'img' : undefined}
	aria-label={title}
	aria-hidden={title ? undefined : 'true'}
>
	<circle cx="9" cy="8.5" r="3" />
	<path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
	<circle cx="17" cy="9.5" r="2.5" />
	<path d="M17 14.5c2.2 0 4 1.6 4 4.5" />
</svg>
