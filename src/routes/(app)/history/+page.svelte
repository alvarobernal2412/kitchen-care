<script lang="ts">
	let { data } = $props();

	const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
</script>

<svelte:head><title>History</title></svelte:head>

<h2>History</h2>
{#if data.periods.length === 0}
	<p class="muted">No finished periods yet.</p>
{:else}
	<ul>
		{#each data.periods as p (p.id)}
			<li>
				<h3>{p.name}</h3>
				<p class="muted">
					{day(p.startsAt)} to {day(p.endsAt)} &middot; {p.participants}
					{p.participants === 1 ? 'participant' : 'participants'}
				</p>
				{#if p.winners.length === 0}
					<p class="muted">No winners.</p>
				{:else}
					<p>
						<span aria-hidden="true">&#127942;</span>
						{#each p.winners as w, i (w.userId)}{i > 0 ? ', ' : ''}<strong>{w.username}</strong>
							({w.points}){/each}
					</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.muted {
		color: #6b7280;
	}
	ul {
		padding: 0;
		margin: 0;
		list-style: none;
	}
	li {
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	h3,
	p {
		margin: 0.25rem 0;
	}
</style>
