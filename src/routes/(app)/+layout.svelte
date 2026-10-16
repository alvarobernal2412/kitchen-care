<script lang="ts">
	import { resolve } from '$app/paths';

	let { data, children } = $props();
</script>

<header>
	<a class="brand" href={resolve('/')}>Kitchen Care Credits</a>
	<form method="POST" action="/logout">
		<span>{data.user.displayUsername}</span>
		<button type="submit" class="link">Log out</button>
	</form>
</header>
<main>
	{@render children()}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #f9fafb;
		color: #111827;
	}
	:global(button) {
		width: 100%;
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
		cursor: not-allowed;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: white;
		border-bottom: 1px solid #e5e7eb;
	}
	.brand {
		font-weight: 700;
		color: inherit;
		text-decoration: none;
	}
	header form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
	}
	button.link {
		width: auto;
		padding: 0.3rem 0.6rem;
		color: #1d4ed8;
		background: transparent;
		border: 1px solid #d1d5db;
	}
	main {
		max-width: 24rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}
</style>
