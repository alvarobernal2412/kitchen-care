<script lang="ts">
	import { avatarUrl } from '$lib/avatar';
	import type { FeedComment } from '$lib/feedTypes';
	import { timeAgo } from '$lib/relativeTime';

	let { postId, count, meId }: { postId: number; count: number; meId: number } = $props();

	// svelte-ignore state_referenced_locally
	let total = $state(count);
	let open = $state(false);
	let loaded = $state(false);
	let loading = $state(false);
	let list = $state<FeedComment[]>([]);
	let draft = $state('');
	let sending = $state(false);
	let error = $state('');
	let confirming = $state<number | null>(null);

	async function show() {
		open = !open;
		if (!open || loaded) return;
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/posts/${postId}/comments`);
			if (!res.ok) throw new Error(String(res.status));
			list = (await res.json()).comments;
			total = list.length;
			loaded = true;
		} catch {
			error = 'Could not load comments.';
		} finally {
			loading = false;
		}
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (sending || !draft.trim()) return;
		sending = true;
		error = '';
		try {
			const res = await fetch(`/api/posts/${postId}/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body: draft })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				error =
					res.status === 429
						? 'Slow down a little, then try again.'
						: (data.message ?? 'Could not post your comment.');
				return;
			}
			list = [...list, data.comment];
			total += 1;
			draft = '';
		} catch {
			error = 'Could not post your comment.';
		} finally {
			sending = false;
		}
	}

	async function remove(id: number) {
		error = '';
		try {
			const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) throw new Error(String(res.status));
			list = list.filter((c) => c.id !== id);
			total = Math.max(0, total - 1);
		} catch {
			error = 'Could not delete the comment.';
		} finally {
			confirming = null;
		}
	}

	const initials = (name: string) => name.slice(0, 2).toUpperCase();
</script>

<div class="comments">
	<button type="button" class="toggle" aria-expanded={open} onclick={show}>
		{open ? 'Hide comments' : 'Show comments'} ({total})
	</button>

	{#if open}
		{#if loading}<p class="muted">Loading…</p>{/if}
		<ul>
			{#each list as c (c.id)}
				<li>
					{#if avatarUrl(c.author.avatar)}
						<img class="avatar" src={avatarUrl(c.author.avatar)} alt="" />
					{:else}
						<span class="avatar fallback" aria-hidden="true">{initials(c.author.username)}</span>
					{/if}
					<div class="content">
						<p class="head">
							<strong>{c.author.username}</strong>
							{#if c.author.deactivated}<span class="muted">(deactivated)</span>{/if}
							<time class="muted" datetime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>
								{timeAgo(c.createdAt)}
							</time>
						</p>
						<p class="text">{c.body}</p>
						{#if c.author.id === meId}
							{#if confirming === c.id}
								<span class="confirm">
									Delete?
									<button type="button" class="mini danger" onclick={() => remove(c.id)}>Yes</button>
									<button type="button" class="mini" onclick={() => (confirming = null)}>No</button>
								</span>
							{:else}
								<button type="button" class="mini" onclick={() => (confirming = c.id)}>Delete</button>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if loaded && list.length === 0}<p class="muted">No comments yet.</p>{/if}

		<form onsubmit={send}>
			<label class="sr" for={`comment-${postId}`}>Add a comment</label>
			<input
				id={`comment-${postId}`}
				type="text"
				maxlength="300"
				placeholder="Add a comment"
				autocomplete="off"
				bind:value={draft}
			/>
			<button type="submit" class="send" disabled={sending || !draft.trim()}>Send</button>
		</form>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.comments {
		margin-top: 0.6rem;
	}
	.toggle {
		width: auto;
		padding: 0.2rem 0;
		font-size: 0.85rem;
		color: #1d4ed8;
		background: transparent;
	}
	ul {
		padding: 0;
		margin: 0.5rem 0;
		list-style: none;
	}
	li {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	.avatar {
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 700;
		color: #1d4ed8;
		background: #dbeafe;
	}
	.content {
		min-width: 0;
		flex: 1;
	}
	.head,
	.text {
		margin: 0;
	}
	.head {
		font-size: 0.8rem;
	}
	.text {
		font-size: 0.9rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.muted {
		margin: 0;
		font-size: 0.8rem;
		color: #6b7280;
	}
	form {
		display: flex;
		gap: 0.4rem;
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem;
		font: inherit;
		border: 1px solid #d1d5db;
		border-radius: 8px;
	}
	.send {
		width: auto;
		padding: 0.5rem 0.9rem;
	}
	.mini {
		width: auto;
		padding: 0.1rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: #374151;
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
	}
	.mini.danger {
		color: white;
		background: #b91c1c;
		border-color: #b91c1c;
	}
	.confirm {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
	}
	.error {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: #b91c1c;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
