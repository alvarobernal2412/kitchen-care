<script lang="ts">
	let { children } = $props();
</script>

<!-- Signed-out screens live outside the app shell: a calm centred column on the plaster ground. -->
<main class="auth">
	<p class="wordmark">Kitchen Care Credits</p>
	{@render children()}
</main>

<style>
	.auth {
		max-width: 26rem;
		min-height: 100dvh;
		margin: 0 auto;
		padding: var(--sp-7) var(--gutter) var(--sp-8);
	}
	.wordmark {
		margin-bottom: var(--sp-6);
		font: 800 var(--fs-h2) / 1.15 var(--font-display);
		letter-spacing: -0.02em;
		color: var(--accent-ink);
	}
	/* Shared by login, sign-up and reset password. */
	.auth :global(h1) {
		font-size: var(--fs-h1);
	}
	.auth :global(.slogan) {
		margin-top: var(--sp-2);
		color: var(--muted);
	}
	.auth :global(form) {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		margin-top: var(--sp-5);
	}
	.auth :global(.alt) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.35em;
		min-height: 44px;
		margin-top: var(--sp-4);
	}
	.auth :global(.alt a) {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.auth :global(.submit) {
		margin-top: var(--sp-2);
	}

	@media (min-width: 900px) {
		.auth {
			padding-top: 96px;
		}
		.wordmark {
			font-size: 28px;
		}
	}
</style>
