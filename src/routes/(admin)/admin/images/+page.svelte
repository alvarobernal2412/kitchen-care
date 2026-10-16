<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	const endedPeriods = $derived(data.periods.filter((p) => !p.active));
</script>

<svelte:head><title>Images</title></svelte:head>

<h2>Proof images</h2>

<form method="GET" action={resolve('/admin/images')} class="filters">
	<label>
		Task
		<select name="task">
			<option value="">All tasks</option>
			{#each data.tasks as t (t.key)}
				<option value={t.key} selected={t.key === data.filters.task}>{t.label}</option>
			{/each}
		</select>
	</label>
	<label>
		Period
		<select name="period">
			<option value="">All periods</option>
			{#each data.periods as p (p.id)}
				<option value={p.id} selected={p.id === data.filters.period}>
					{p.name}{p.active ? ' (active)' : ''}
				</option>
			{/each}
		</select>
	</label>
	<label>
		User
		<input type="text" name="user" value={data.filters.user} maxlength="64" placeholder="Username" />
	</label>
	<button type="submit">Filter</button>
</form>

{#if data.paged}
	<p><a href={resolve('/admin/images')}>&larr; Back to newest</a></p>
{/if}

{#if data.items.length === 0}
	<p class="muted">No stored proof images match.</p>
{/if}

<ul class="grid">
	{#each data.items as i (i.id)}
		<li>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /media is a file endpoint, not a route -->
			<a href={`/media/${i.imagePath}`} target="_blank" rel="noopener">
				<img src="/media/{i.imagePath}" alt="Proof for {i.taskLabel} by {i.username}" loading="lazy" />
			</a>
			<div><strong>{i.taskLabel}</strong></div>
			<div>{i.username}</div>
			<div class="muted">{i.status} &middot; {i.createdAt.slice(0, 10)}{i.periodName ? ` · ${i.periodName}` : ''}</div>
		</li>
	{/each}
</ul>

{#if data.next !== null}
	<p><a href="{resolve('/admin/images')}?{data.nextQuery}">Older images</a></p>
{/if}

<h3>Delete stored proofs</h3>
<p class="muted">
	Removes the photo files of an ended period. Points, statuses, leaderboard and winners stay as they
	are. This cannot be undone.
</p>
{#if endedPeriods.length === 0}
	<p class="muted">No ended periods yet. A running period's proofs cannot be deleted.</p>
{/if}
{#each endedPeriods as p (p.id)}
	<section>
		<strong>{p.name}</strong>
		{#if form?.periodId === p.id}
			{#if form.error}<p class="error" role="alert">{form.error}</p>{/if}
			{#if form.removed !== undefined}
				<p class="ok" role="status">
					Removed {form.removed} {form.removed === 1 ? 'image' : 'images'}{form.failed
						? `; ${form.failed} could not be removed (try again or check the server).`
						: '.'}
				</p>
			{/if}
		{/if}
		<details>
			<summary>Delete proof images</summary>
			<form method="POST" action="?/deleteImages" use:enhance>
				<input type="hidden" name="periodId" value={p.id} />
				<label class="confirm">
					<input type="checkbox" name="confirm" value="yes" required />
					Confirm: permanently delete all proof photos of {p.name}.
				</label>
				<button type="submit" class="danger">Delete proof images</button>
			</form>
		</details>
	</section>
{/each}

<style>
	.muted {
		color: #6b7280;
		font-size: 0.9rem;
	}
	.filters {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	.filters label {
		display: grid;
		gap: 0.25rem;
	}
	select {
		padding: 0.6rem;
		font: inherit;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0.75rem;
		padding: 0;
		list-style: none;
	}
	.grid li {
		padding: 0.5rem;
		font-size: 0.85rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow-wrap: anywhere;
	}
	.grid img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: 6px;
	}
	section {
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	form {
		display: grid;
		gap: 0.5rem;
	}
	summary {
		cursor: pointer;
		color: #b91c1c;
	}
	.confirm {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.ok {
		color: #166534;
	}
	.error {
		color: #991b1b;
	}
</style>
