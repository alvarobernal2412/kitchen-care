<script lang="ts" module>
	/** First letters of the first and last word, upper-cased; Unicode-safe (code points, not UTF-16 units). */
	export function initialsOf(name: string): string {
		const words = name.trim().split(/\s+/).filter(Boolean);
		if (words.length === 0) return '?';
		const first = Array.from(words[0])[0];
		const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
		return (first + last).toLocaleUpperCase();
	}
</script>

<script lang="ts">
	import { avatarTint } from '$lib/avatarTint';

	/**
	 * Rounded-square avatar. Pass `src` as `avatarUrl(user.avatarPath)` (from `$lib/avatar`); this
	 * component never builds URLs itself. Decorative by default (a visible name sits next to it);
	 * set `label` to expose an accessible name when it stands alone.
	 */
	let {
		name,
		src = null,
		size = 44,
		seed,
		label
	}: {
		name: string;
		src?: string | null;
		size?: number;
		seed?: number | string;
		label?: string;
	} = $props();

	let failed = $state(false);
	// A new src gets a fresh chance to load.
	$effect(() => {
		void src;
		failed = false;
	});

	const tint = $derived(avatarTint(seed ?? name));
	const initials = $derived(initialsOf(name));
	const radius = $derived(Math.max(6, Math.round((size * 12) / 44)));
</script>

<span
	class="avatar"
	style:width="{size}px"
	style:height="{size}px"
	style:border-radius="{radius}px"
	style:font-size="{Math.round(size * 0.36)}px"
	style:background={tint.bg}
	style:color={tint.fg}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#if src && !failed}
		<img {src} alt="" loading="lazy" onerror={() => (failed = true)} />
	{:else}
		{initials}
	{/if}
</span>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		overflow: hidden;
		font-family: var(--font-body);
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0;
		user-select: none;
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
