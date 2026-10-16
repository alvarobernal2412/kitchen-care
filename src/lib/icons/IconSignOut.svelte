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
	<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
	<path d="M14 8l4 4-4 4" />
	<path d="M8.5 12H18" />
</svg>
