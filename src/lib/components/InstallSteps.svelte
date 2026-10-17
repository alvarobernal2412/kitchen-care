<script lang="ts">
	import { IconShare } from '$lib/icons';
	import { install } from '$lib/client/install.svelte';
	import type { InstallInstructions } from '$lib/client/installHelp';

	let { help }: { help: InstallInstructions } = $props();

	// The Share glyph goes right after the words that name the button.
	const GLYPH = /(Share button|share icon)/;
	const parts = (s: string) => s.split(GLYPH);
</script>

{#if help.steps.length > 0}
	<ol class="steps">
		{#each help.steps as step (step)}
			<li>
				{#each parts(step) as part, i (i)}
					{#if GLYPH.test(part)}{part}<IconShare size={18} class="glyph" />{:else}{part}{/if}
				{/each}
			</li>
		{/each}
	</ol>
{/if}
{#if help.note}<p class="how">{help.note}</p>{/if}
{#if help.button && install.canPromptNatively}
	<button type="button" class="btn btn-primary" onclick={() => install.promptInstall()}>
		{help.button}
	</button>
{/if}

<style>
	.steps {
		margin: 0;
		padding-left: 1.25em;
		display: grid;
		gap: var(--sp-2);
		line-height: 1.4;
	}
	.steps :global(.glyph) {
		display: inline-block;
		vertical-align: -3px;
		margin-left: 4px;
		color: var(--accent-ink);
	}
	.how {
		margin: var(--sp-3) 0 0;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.btn {
		margin-top: var(--sp-3);
	}
</style>
