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
	<path d="M7 4h10" />
	<path d="M7 20h10" />
	<path d="M8 4c0 4 4 5 4 8s-4 4-4 8" />
	<path d="M16 4c0 4-4 5-4 8s4 4 4 8" />
</svg>
