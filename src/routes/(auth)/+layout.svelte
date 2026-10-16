<script lang="ts">
	let { children } = $props();
</script>

<main>
	<h1>Kitchen Care Credits</h1>
	{@render children()}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #f9fafb;
		color: #111827;
	}
	:global(label) {
		display: block;
		margin-top: 1rem;
		font-weight: 600;
	}
	:global(input[type='text']),
	:global(input[type='password']),
	:global(select) {
		box-sizing: border-box;
		width: 100%;
		margin-top: 0.25rem;
		padding: 0.7rem;
		font: inherit;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: white;
	}
	:global(button) {
		width: 100%;
		margin-top: 1.5rem;
		padding: 0.8rem;
		font: inherit;
		font-weight: 600;
		color: white;
		background: #1d4ed8;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	:global(button:disabled) {
		opacity: 0.6;
	}
	:global(.error) {
		margin: 1rem 0 0;
		padding: 0.6rem 0.8rem;
		color: #991b1b;
		background: #fee2e2;
		border-radius: 8px;
	}
	main {
		max-width: 24rem;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	h1 {
		font-size: 1.4rem;
	}
</style>
