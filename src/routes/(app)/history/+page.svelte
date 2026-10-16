<script lang="ts">
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';

	let { data } = $props();

	const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
</script>

<svelte:head><title>History</title></svelte:head>

<div class="page">
	<header>
		<h1>History</h1>
		<p class="back"><a href={resolve('/leaderboard')}>&larr; Current standings</a></p>
	</header>

	{#if data.periods.length === 0}
		<p class="empty">No finished periods yet.</p>
	{:else}
		<ol class="periods">
			{#each data.periods as p (p.id)}
				<li>
					<div class="head">
						<h2>{p.name}</h2>
						{#if p.winners.length > 1}<span class="chip">Tied</span>{/if}
					</div>
					<p class="dates">
						{day(p.startsAt)} to {day(p.endsAt)} &middot; {p.participants}
						{p.participants === 1 ? 'participant' : 'participants'}
					</p>
					{#if p.winners.length === 0}
						<p class="dates">No winners.</p>
					{:else}
						<ul class="winners" aria-label="Winners">
							{#each p.winners as w (w.userId)}
								<li>
									<Avatar name={w.username} seed={w.userId} size={36} />
									<span class="name">{w.username}</span>
									<span class="pts">{w.points}<span class="visually-hidden"> points</span></span>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.page {
		padding: var(--sp-5) 0 var(--sp-6);
	}
	.back {
		margin-top: var(--sp-1);
		font-size: var(--fs-ui);
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.periods,
	.winners {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.periods {
		margin-top: var(--sp-3);
		border-top: 2px solid var(--accent);
	}
	.periods > li {
		padding: var(--sp-5) 0 var(--sp-3);
		border-bottom: 1px solid var(--line);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.dates {
		margin-top: var(--sp-1);
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.winners {
		margin-top: var(--sp-3);
	}
	.winners li {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-3);
		min-height: 52px;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.pts {
		font: 700 24px / 1 var(--font-display);
		letter-spacing: -0.02em;
	}
	.empty {
		padding: var(--sp-5) 0;
		border-top: 2px solid var(--accent);
		color: var(--muted);
	}

	@media (min-width: 900px) {
		.page {
			padding-top: var(--sp-6);
		}
		.periods,
		header {
			max-width: 640px;
		}
	}
</style>
