<script lang="ts">
	import { resolve } from '$app/paths';
	import { avatarUrl } from '$lib/avatar';

	let { data } = $props();

	const initials = (name: string) => name.slice(0, 2).toUpperCase();
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<h2>Leaderboard</h2>
{#if data.period}<p class="muted">{data.period.name}</p>{/if}
<p><a href={resolve('/history')}>Past periods</a></p>

<form method="GET" class="filters">
	<label>
		Show
		<select name="group" value={data.group}>
			<option value="all">All</option>
			<option value="students">Students</option>
			<option value="employees">Employees</option>
		</select>
	</label>
	{#if data.group === 'employees'}
		<label>
			Department
			<select name="dept" value={data.dept}>
				<option value="">All departments</option>
				{#each data.departments as d (d)}
					<option value={d}>{d}</option>
				{/each}
			</select>
		</label>
	{/if}
	<button type="submit" class="apply">Apply</button>
</form>

{#if !data.period}
	<p class="muted">No active period right now.</p>
{:else if data.rows.length === 0}
	<p class="muted">No points yet. Be the first!</p>
{:else}
	<ol>
		{#each data.rows as row (row.userId)}
			<li class:me={row.userId === data.meId}>
				<span class="rank">{row.rank}</span>
				{#if avatarUrl(row.avatar)}
					<img class="avatar" src={avatarUrl(row.avatar)} alt="" />
				{:else}
					<span class="avatar fallback" aria-hidden="true">{initials(row.username)}</span>
				{/if}
				<span class="name">{row.username}{#if row.userId === data.meId} (you){/if}</span>
				<strong>{row.points}</strong>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.muted {
		color: #6b7280;
	}
	.filters {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.filters label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	select {
		padding: 0.5rem;
		font: inherit;
	}
	.apply {
		padding: 0.5rem;
	}
	ol {
		padding: 0;
		margin: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		margin-bottom: 0.4rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	li.me {
		background: #eff6ff;
		border-color: #1d4ed8;
	}
	.rank {
		min-width: 1.5rem;
		font-weight: 700;
		text-align: center;
	}
	.avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: #1d4ed8;
		background: #dbeafe;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
