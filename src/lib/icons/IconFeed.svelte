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
	<rect x="4" y="4" width="16" height="10.5" rx="2.5" />
	<path d="M4 18h11" />
	<path d="M4 21h6.5" />
</svg>
