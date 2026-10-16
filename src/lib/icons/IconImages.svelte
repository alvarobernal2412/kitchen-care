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
	<rect x="3" y="8" width="14" height="12" rx="2" />
	<path d="M7 8V6.5a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-2" />
	<path d="M3 17l4-3.5 3.5 3" />
	<circle cx="8" cy="12" r="1" />
</svg>
