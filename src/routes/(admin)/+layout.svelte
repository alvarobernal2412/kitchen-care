<script lang="ts">
	import { resolve } from '$app/paths';

	let { data, children } = $props();
</script>

<header>
	<a class="brand" href={resolve('/')}>Kitchen Care Credits</a>
	<nav>
		<a href={resolve('/admin/periods')}>Periods</a>
	</nav>
	<span>{data.user.displayUsername}</span>
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
		padding: 0.7rem 1rem;
		font: inherit;
		font-weight: 600;
		color: white;
		background: #1d4ed8;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	:global(button.danger) {
		background: #b91c1c;
	}
	:global(input[type='text']) {
		box-sizing: border-box;
		width: 100%;
		padding: 0.6rem;
		font: inherit;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
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
	nav {
		flex: 1;
	}
	nav a {
		color: #1d4ed8;
	}
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}
</style>
