<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>Review queue</title></svelte:head>

<h2>Review queue</h2>

{#if form?.error && !form.submissionId}
	<p class="error" role="alert">{form.error}</p>
{/if}

{#if data.pending.length === 0}
	<p class="muted">Nothing waiting for review.</p>
{/if}

<ul>
	{#each data.pending as item (item.id)}
		<li>
			<p>
				<strong>{item.taskLabel}</strong> by {item.username}
				<small>{new Date(item.createdAt).toLocaleString()}</small>
			</p>
			{#if item.imagePath}
				<img src={`/media/${item.imagePath}`} alt={`Proof for ${item.taskLabel}`} loading="lazy" />
			{/if}
			{#if form?.error && form.submissionId === item.id}
				<p class="error" role="alert">{form.error}</p>
			{/if}
			<div class="actions">
				<form method="POST" action="?/approve" use:enhance>
					<input type="hidden" name="submissionId" value={item.id} />
					<button type="submit">Approve</button>
				</form>
				<form method="POST" action="?/reject" use:enhance>
					<input type="hidden" name="submissionId" value={item.id} />
					<select name="reason" aria-label="Reject reason">
						{#each data.reasons as reason (reason)}
							<option value={reason}>{reason}</option>
						{/each}
					</select>
					<input type="text" name="note" maxlength="150" placeholder="Optional note" />
					<button type="submit" class="danger">Reject</button>
				</form>
			</div>
		</li>
	{/each}
</ul>

<style>
	ul {
		padding: 0;
		list-style: none;
	}
	li {
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	img {
		display: block;
		max-width: 100%;
		max-height: 24rem;
		margin: 0.5rem 0;
		border-radius: 6px;
	}
	.actions {
		display: grid;
		gap: 0.75rem;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	select {
		font: inherit;
		padding: 0.5rem;
	}
	form input[type='text'] {
		flex: 1;
		min-width: 8rem;
	}
	small,
	.muted {
		color: #6b7280;
	}
	.error {
		padding: 0.6rem 0.8rem;
		color: #991b1b;
		background: #fee2e2;
		border-radius: 8px;
	}
</style>
