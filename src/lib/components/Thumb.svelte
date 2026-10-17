<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * A 4:3 proof-image frame for the admin screens: lazy, a quiet pulse while it loads, and a plain
	 * "Image unavailable" in the same frame when the file is gone (an admin may have deleted it).
	 * With `href` it is a link to the full file in a new tab. `src` and `href` are `/media/<file>`
	 * paths built from stored file names, never user-controlled URLs.
	 */
	let { src, alt, href }: { src: string; alt: string; href?: string } = $props();

	let img = $state<HTMLImageElement>();
	let loaded = $state(false);
	let broken = $state(false);
	let mounted = $state(false);

	// An event that fired before hydration is not seen by the handlers, so look again once mounted.
	onMount(() => {
		mounted = true;
		if (img?.complete) {
			if (img.naturalWidth === 0) broken = true;
			else loaded = true;
		}
	});
</script>

{#snippet frame()}
	<span class="frame" class:loading={mounted && !loaded && !broken}>
		<img
			bind:this={img}
			{src}
			{alt}
			loading="lazy"
			hidden={broken}
			onload={() => (loaded = true)}
			onerror={() => (broken = true)}
		/>
		{#if broken}<span class="gone">Image unavailable</span>{/if}
	</span>
{/snippet}

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /media is a file endpoint, not a route -->
	<a class="thumb" {href} target="_blank" rel="noopener" aria-label={broken ? alt : undefined}>
		{@render frame()}
	</a>
{:else}
	<span class="thumb">{@render frame()}</span>
{/if}

<style>
	.thumb {
		display: block;
		border-radius: var(--r-ctl);
	}
	.frame {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border-radius: var(--r-ctl);
		background: var(--photo);
	}
	.frame.loading {
		animation: thumb-pulse 1.4s ease-in-out infinite;
	}
	img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.gone {
		padding: var(--sp-2);
		color: var(--muted);
		font-size: var(--fs-small);
		text-align: center;
	}
	@keyframes thumb-pulse {
		50% {
			opacity: 0.6;
		}
	}
</style>
