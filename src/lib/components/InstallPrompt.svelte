<script lang="ts">
	import { onMount } from 'svelte';
	import { install } from '$lib/client/install.svelte';
	import { installInstructions } from '$lib/client/installHelp';
	import InstallSteps from './InstallSteps.svelte';

	onMount(() => install.start());

	const help = $derived(install.bannerVisible ? installInstructions(install.env) : null);
</script>

{#if help}
	<section class="install" aria-label="Install the app">
		<h2>{help.title}</h2>
		<InstallSteps {help} />
		<div class="row">
			<button type="button" class="btn btn-quiet" onclick={() => install.dismiss()}>Got it</button>
		</div>
	</section>
{/if}

<style>
	.install {
		margin-top: var(--sp-5);
		padding: var(--sp-4);
		border-radius: var(--r-tile);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
	}
	h2 {
		margin-bottom: var(--sp-3);
		font-size: var(--fs-lead);
		line-height: 1.25;
	}
	.row {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--sp-3);
	}
</style>
