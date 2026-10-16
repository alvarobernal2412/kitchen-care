<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
</script>

<svelte:head><title>Periods</title></svelte:head>

<h2>Periods</h2>

{#if form?.action === 'end' && !form.error}
	<p class="ok" role="status">
		Period ended. {form.winnerCount === 0
			? 'Nobody scored, so there are no winners.'
			: `Winners recorded (see below).`}
	</p>
{/if}
{#if form?.action === 'create' && !form.error}
	<p class="ok" role="status">Period "{form.created}" started.</p>
{/if}

{#if data.active}
	<section>
		<h3>Active: {data.active.name}</h3>
		<p class="muted">
			Started {day(data.active.startsAt)} &middot; {data.active.participants} scoring
			{data.active.participants === 1 ? 'participant' : 'participants'}
		</p>
		{#if data.active.pending > 0}
			<p class="warn" role="status">
				{data.active.pending}
				{data.active.pending === 1 ? 'submission' : 'submissions'} still pending review &mdash; they can
				only be rejected after the period ends.
			</p>
		{/if}
		<form method="POST" action="?/end" use:enhance>
			<input type="hidden" name="periodId" value={data.active.id} />
			<label class="confirm">
				<input type="checkbox" name="confirm" value="yes" required />
				I understand this ends the period now, records the winners, and cannot be undone.
			</label>
			{#if form?.action === 'end' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
			<button type="submit" class="danger">End period</button>
		</form>
	</section>
{:else}
	<section>
		<h3>Start a new period</h3>
		<form method="POST" action="?/create" use:enhance>
			<label>
				Name
				<input
					type="text"
					name="name"
					required
					maxlength="80"
					placeholder="e.g. November 2026"
					value={form?.action === 'create' && form.error ? (form.name ?? '') : ''}
				/>
			</label>
			{#if form?.action === 'create' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
			<button type="submit">Create period</button>
		</form>
	</section>
{/if}

<h3>Past periods</h3>
{#if data.past.length === 0}
	<p class="muted">No finished periods yet.</p>
{:else}
	<ul>
		{#each data.past as p (p.id)}
			<li>
				<strong>{p.name}</strong>
				<span class="muted">
					{day(p.startsAt)} to {day(p.endsAt)} &middot; {p.participants}
					{p.participants === 1 ? 'participant' : 'participants'}
				</span>
				<div>
					{#if p.winners.length === 0}
						No winners
					{:else}
						Winners: {#each p.winners as w, i (w.userId)}{i > 0 ? ', ' : ''}{w.username} ({w.points}){/each}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.muted {
		color: #6b7280;
	}
	section {
		padding: 1rem;
		margin-bottom: 1.5rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	form {
		display: grid;
		gap: 0.75rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	.confirm {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	ul {
		padding: 0;
		list-style: none;
	}
	li {
		padding: 0.75rem;
		margin-bottom: 0.5rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	.ok {
		padding: 0.6rem 0.8rem;
		color: #166534;
		background: #dcfce7;
		border-radius: 8px;
	}
	.warn {
		padding: 0.6rem 0.8rem;
		color: #92400e;
		background: #fef3c7;
		border-radius: 8px;
	}
	.error {
		margin: 0;
		color: #991b1b;
	}
</style>
