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
	<path d="M3 20.5h18" />
	<rect x="9" y="5.5" width="6" height="15" />
	<rect x="3" y="11.5" width="6" height="9" />
	<rect x="15" y="14" width="6" height="6.5" />
</svg>
