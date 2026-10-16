<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	import { errorCopy } from '$lib/errorCopy';

	// Fixed copy per status. The error's own message is never shown: it can come from server code.
	const status = $derived(page.status);
	const copy = $derived(errorCopy(status));
</script>

<svelte:head><title>{copy.title}</title></svelte:head>

<main class="err">
	<p class="wordmark">Kitchen Care Credits</p>
	<p class="code num">{status}</p>
	<h1>{copy.title}</h1>
	<p class="text">{copy.text}</p>
	<div class="actions">
		<a class="btn btn-primary" href={resolve('/')}>Go home</a>
		{#if copy.offerLogin}<a class="btn btn-quiet" href={resolve('/login')}>Log in</a>{/if}
	</div>
</main>

<style>
	.err {
		max-width: 26rem;
		min-height: 100dvh;
		margin: 0 auto;
		padding: var(--sp-7) var(--gutter) var(--sp-8);
	}
	.wordmark {
		margin-bottom: var(--sp-7);
		font: 800 var(--fs-h2) / 1.15 var(--font-display);
		letter-spacing: -0.02em;
		color: var(--accent-ink);
	}
	.code {
		font: 800 var(--fs-points) / 0.95 var(--font-display);
		letter-spacing: -0.03em;
		color: var(--muted);
	}
	h1 {
		margin-top: var(--sp-3);
		font-size: var(--fs-h1);
	}
	.text {
		margin-top: var(--sp-3);
		color: var(--muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		margin-top: var(--sp-5);
	}

	@media (min-width: 900px) {
		.err {
			padding-top: 96px;
		}
	}
</style>
