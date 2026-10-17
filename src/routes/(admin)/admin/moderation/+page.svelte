<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarUrl } from '$lib/avatar';
	import Notice from '$lib/components/Notice.svelte';
	import RelativeTime from '$lib/components/RelativeTime.svelte';
	import Thumb from '$lib/components/Thumb.svelte';

	let { data, form } = $props();

	// The result is shown above the list, so the confirmation folds away once it is sent.
	const closing: SubmitFunction = () => async ({ formElement, update }) => {
		formElement.closest('details')?.removeAttribute('open');
		await update();
	};
</script>

<svelte:head><title>Moderation</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Moderation</h1>
		<p class="sub">Recent posts and their comments. Deleting is permanent.</p>
	</header>

	{#if form?.deleted}
		<Notice kind="ok" role="status">Deleted the {form.kind}.</Notice>
	{:else if form?.error && form.id === undefined}
		<Notice kind="error" role="alert">{form.error}</Notice>
	{/if}

	{#if data.paged}
		<p class="back"><a href={resolve('/admin/moderation')}>&larr; Back to newest</a></p>
	{/if}

	{#if data.posts.length === 0}
		<p class="empty">No posts.</p>
	{:else}
		<ul class="rows" aria-label="Recent posts">
			{#each data.posts as post (post.id)}
				<li>
					<article class="post">
						<header class="head">
							<Avatar
								name={post.author.username}
								src={avatarUrl(post.author.avatar)}
								seed={post.author.id}
								size={40}
							/>
							<p class="name">
								<b>{post.author.username}</b>
								{#if post.author.deactivated}<span class="chip chip-neutral">Deactivated</span>{/if}
								{#if post.milestone}<span class="chip">Milestone</span>{/if}
								<RelativeTime iso={post.createdAt} class="when" />
							</p>
						</header>
						<p class="post-title">{post.title}</p>
						{#if post.body}<p class="body">{post.body}</p>{/if}
						{#if post.imagePath}
							<div class="proof">
								<Thumb
									src={`/media/${post.imagePath}`}
									href={`/media/${post.imagePath}`}
									alt={`Photo in the post by ${post.author.username}`}
								/>
							</div>
						{/if}

						{#if form?.kind === 'post' && form.id === post.id && form.error}
							<Notice kind="error" role="alert">{form.error}</Notice>
						{/if}
						<details class="disclose">
							<summary class="btn btn-quiet">Delete post</summary>
							<form method="POST" action="?/deletePost" use:enhance={closing} class="confirm">
								<input type="hidden" name="id" value={post.id} />
								<label class="check">
									<input type="checkbox" name="confirm" value="yes" required />
									<span
										>Confirm: delete the post “{post.title}”, its {post.commentCount}
										{post.commentCount === 1 ? 'comment' : 'comments'} and reactions.</span
									>
								</label>
								<button type="submit" class="btn btn-danger">Delete post permanently</button>
							</form>
						</details>

						{#if post.comments.length > 0}
							<details class="comments">
								<summary
									>{post.comments.length}
									{post.comments.length === 1 ? 'comment' : 'comments'}</summary
								>
								<ul>
									{#each post.comments as c (c.id)}
										<li>
											<p class="name">
												<b>{c.author.username}</b>
												<RelativeTime iso={c.createdAt} class="when" />
											</p>
											<p class="body">{c.body}</p>
											{#if form?.kind === 'comment' && form.id === c.id && form.error}
												<Notice kind="error" role="alert">{form.error}</Notice>
											{/if}
											<details class="disclose">
												<summary class="btn btn-quiet">Delete comment</summary>
												<form
													method="POST"
													action="?/deleteComment"
													use:enhance={closing}
													class="confirm"
												>
													<input type="hidden" name="id" value={c.id} />
													<label class="check">
														<input type="checkbox" name="confirm" value="yes" required />
														<span>Confirm: delete this comment.</span>
													</label>
													<button type="submit" class="btn btn-danger">Delete comment permanently</button>
												</form>
											</details>
										</li>
									{/each}
								</ul>
							</details>
						{/if}
					</article>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.next}
		<p class="more">
			<a
				class="btn btn-quiet"
				href="{resolve('/admin/moderation')}?before={encodeURIComponent(data.next.before)}&beforeId={data.next.beforeId}"
			>
				Older posts
			</a>
		</p>
	{/if}
</div>

<style>
	.back {
		margin-bottom: var(--sp-3);
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.post {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-1) var(--sp-2);
		max-width: none;
	}
	.name b {
		font-weight: 600;
	}
	.name :global(.when) {
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.post-title {
		max-width: none;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.proof {
		width: min(100%, 220px);
	}
	.disclose summary {
		display: inline-flex;
		list-style: none;
	}
	.disclose summary::-webkit-details-marker {
		display: none;
	}
	.confirm {
		display: grid;
		gap: var(--sp-1);
		justify-items: start;
		margin-top: var(--sp-2);
	}
	.comments {
		width: 100%;
	}
	.comments > summary {
		display: flex;
		align-items: center;
		min-height: 44px;
		color: var(--accent-ink);
		font-weight: 600;
		cursor: pointer;
	}
	.comments ul {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--line);
	}
	.comments li {
		display: grid;
		gap: var(--sp-2);
		justify-items: start;
		padding: var(--sp-3) 0;
		border-bottom: 1px solid var(--line);
	}
	.comments li:last-child {
		border-bottom: 0;
	}
	.more {
		margin-top: var(--sp-4);
	}
	.more a {
		width: 100%;
	}
	@media (min-width: 900px) {
		.more a {
			width: auto;
		}
	}
</style>
