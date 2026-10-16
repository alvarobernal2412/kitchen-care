<script lang="ts">
	import { avatarUrl } from '$lib/avatar';
	import type { FeedComment } from '$lib/feedTypes';
	import { IconCaretRight } from '$lib/icons';
	import Avatar from './Avatar.svelte';
	import RelativeTime from './RelativeTime.svelte';

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
</script>

<div class="comments">
	<button type="button" class="toggle" aria-expanded={open} onclick={show}>
		<IconCaretRight size={18} class="caret" />
		<span><b>{total}</b> {total === 1 ? 'comment' : 'comments'}</span>
	</button>

	{#if open}
		{#if loading}<p class="muted">Loading…</p>{/if}
		<ul>
			{#each list as c (c.id)}
				<li>
					<Avatar name={c.author.username} src={avatarUrl(c.author.avatar)} seed={c.author.id} size={32} />
					<div class="content">
						<p class="head">
							<b class="who">{c.author.username}</b>
							{#if c.author.deactivated}<span class="muted">(left)</span>{/if}
							<RelativeTime iso={c.createdAt} class="muted" />
						</p>
						<p class="text">{c.body}</p>
						{#if c.author.id === meId}
							{#if confirming === c.id}
								<span class="confirm">
									Delete?
									<button type="button" class="act danger" onclick={() => remove(c.id)}>Yes</button>
									<button type="button" class="act" onclick={() => (confirming = null)}>No</button>
								</span>
							{:else}
								<button type="button" class="act" onclick={() => (confirming = c.id)}>Delete</button>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if loaded && list.length === 0}<p class="muted none">No comments yet.</p>{/if}

		<form onsubmit={send}>
			<label class="label" for={`comment-${postId}`}>Add a comment</label>
			<div class="send-row">
				<input
					id={`comment-${postId}`}
					class="input"
					type="text"
					maxlength="300"
					autocomplete="off"
					bind:value={draft}
				/>
				<button type="submit" class="btn btn-primary send" disabled={sending || !draft.trim()}>
					Send
				</button>
			</div>
		</form>
	{/if}
	{#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
	.toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: auto;
		min-height: 44px;
		padding: 0 2px;
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 14px;
		font-weight: 400;
		cursor: pointer;
	}
	.toggle b {
		color: var(--ink);
		font-weight: 600;
	}
	.toggle :global(.caret) {
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.toggle[aria-expanded='true'] :global(.caret) {
		transform: rotate(90deg);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		gap: var(--sp-3);
		padding: var(--sp-3) 0;
		border-top: 1px solid var(--line);
	}
	.content {
		min-width: 0;
		flex: 1;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--sp-2);
		font-size: var(--fs-small);
	}
	.who {
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.text {
		font-size: 15px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.none {
		padding-bottom: var(--sp-3);
	}
	form {
		margin-top: var(--sp-2);
	}
	.send-row {
		display: flex;
		gap: var(--sp-2);
		margin-top: 6px;
	}
	.send-row .input {
		flex: 1;
		min-width: 0;
	}
	.send {
		width: auto;
		flex: none;
	}
	.act {
		width: auto;
		min-height: 44px;
		padding: 0 var(--sp-3);
		border: 1px solid transparent;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--muted);
		font-size: var(--fs-small);
		font-weight: 600;
		cursor: pointer;
	}
	.act:hover {
		background: var(--recess);
	}
	.act.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
	.act.danger:hover {
		background: var(--danger-wash);
	}
	.confirm {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		font-size: var(--fs-small);
	}
	.err {
		margin-top: var(--sp-2);
		color: var(--danger);
		font-size: var(--fs-small);
	}
</style>
