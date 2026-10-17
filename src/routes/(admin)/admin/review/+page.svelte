<script lang="ts">
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarUrl } from '$lib/avatar';
	import Notice from '$lib/components/Notice.svelte';
	import RelativeTime from '$lib/components/RelativeTime.svelte';
	import Thumb from '$lib/components/Thumb.svelte';

	let { data, form } = $props();

	const count = $derived(data.pending.length);
</script>

<svelte:head><title>Review queue</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Review queue</h1>
		<p class="sub">
			{#if count === 0}
				Nothing is waiting.
			{:else}
				{count} {count === 1 ? 'submission is' : 'submissions are'} waiting. Credits are added to the
				total when you approve.
			{/if}
		</p>
	</header>

	{#if form?.error && !form.submissionId}
		<Notice kind="error" role="alert">{form.error}</Notice>
	{/if}

	{#if count === 0}
		<p class="empty">Nothing to review. New photos show up here.</p>
	{:else}
		<ul class="rows queue" aria-label="Pending submissions">
			{#each data.pending as item (item.id)}
				{@const failed = form?.error && form.submissionId === item.id}
				<li class="q">
					<div class="photo">
						{#if item.imagePath}
							<Thumb
								src={`/media/${item.imagePath}`}
								href={`/media/${item.imagePath}`}
								alt={`Proof for ${item.taskLabel}`}
							/>
						{:else}
							<p class="nophoto">No photo</p>
						{/if}
					</div>

					<div class="info">
						<p class="who">
							<Avatar name={item.username} src={avatarUrl(item.avatarPath)} size={32} />
							<b>{item.username}</b>
							<RelativeTime iso={item.createdAt} class="when" />
						</p>
						<h2>{item.taskLabel}</h2>
						<span class="chip"
							>+{item.points} {item.points === 1 ? 'credit' : 'credits'} on approval</span
						>
					</div>

					<div class="act">
						{#if failed}
							<Notice kind="error" role="alert" id="err-{item.id}">{form?.error}</Notice>
						{/if}
						<form id="reject-{item.id}" method="POST" action="?/reject" use:enhance class="reason">
							<input type="hidden" name="submissionId" value={item.id} />
							<label class="label" for="reason-{item.id}">Reason, if you reject</label>
							<select
								id="reason-{item.id}"
								name="reason"
								class="select"
								aria-describedby={failed ? `err-${item.id}` : undefined}
							>
								<option value="">Choose a reason</option>
								{#each data.reasons as reason (reason)}
									<option value={reason}>{reason}</option>
								{/each}
							</select>
							<label class="label" for="note-{item.id}">Note (optional)</label>
							<input
								id="note-{item.id}"
								type="text"
								name="note"
								class="input"
								maxlength="150"
								autocomplete="off"
							/>
						</form>
						<form id="approve-{item.id}" method="POST" action="?/approve" use:enhance>
							<input type="hidden" name="submissionId" value={item.id} />
						</form>
						<div class="btns">
							<button type="submit" form="reject-{item.id}" class="btn btn-danger">Reject</button>
							<button type="submit" form="approve-{item.id}" class="btn btn-primary">Approve</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.queue {
		margin-top: var(--sp-2);
	}
	.q {
		display: grid;
		gap: var(--sp-4);
	}
	.nophoto {
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		border-radius: var(--r-ctl);
		background: var(--photo);
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-2) 10px;
		max-width: none;
		font-size: 14px;
	}
	.who b {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.who :global(.when) {
		color: var(--muted);
	}
	h2 {
		margin: 10px 0;
		font-size: var(--fs-h2);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.act {
		display: grid;
		gap: var(--sp-3);
		align-content: start;
	}
	.reason {
		display: grid;
		gap: 4px;
	}
	.reason .label {
		color: var(--muted);
		font-size: 13px;
		font-weight: 400;
	}
	.reason .label:not(:first-child) {
		margin-top: var(--sp-2);
	}
	.btns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-2);
	}

	@media (min-width: 900px) {
		.q {
			grid-template-columns: 208px minmax(0, 1fr) 248px;
			gap: var(--sp-5);
			padding: 20px;
			align-items: start;
		}
	}
</style>
