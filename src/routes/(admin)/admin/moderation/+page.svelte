<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
</script>

<svelte:head><title>Moderation</title></svelte:head>

<h2>Moderation</h2>

{#if form?.deleted}
	<p class="ok" role="status">Deleted the {form.kind}.</p>
{:else if form?.error && form.id === undefined}
	<p class="error" role="alert">{form.error}</p>
{/if}

{#if data.paged}
	<p><a href={resolve('/admin/moderation')}>&larr; Back to newest</a></p>
{/if}

{#if data.posts.length === 0}
	<p class="muted">No posts.</p>
{/if}

{#each data.posts as post (post.id)}
	<article>
		<header>
			<strong>{post.author.username}</strong>
			{#if post.author.deactivated}<span class="muted">(deactivated)</span>{/if}
			<span class="muted">{post.createdAt.slice(0, 16).replace('T', ' ')} UTC</span>
			{#if post.milestone}<span class="tag">milestone</span>{/if}
		</header>
		<p class="body">{post.body}</p>

		{#if form?.kind === 'post' && form.id === post.id && form.error}
			<p class="error" role="alert">{form.error}</p>
		{/if}
		<details>
			<summary>Delete post</summary>
			<form method="POST" action="?/deletePost" use:enhance>
				<input type="hidden" name="id" value={post.id} />
				<label class="confirm">
					<input type="checkbox" name="confirm" value="yes" required />
					Confirm: delete this post, its {post.commentCount}
					{post.commentCount === 1 ? 'comment' : 'comments'} and reactions.
				</label>
				<button type="submit" class="danger">Delete post</button>
			</form>
		</details>

		{#if post.comments.length > 0}
			<details class="comments">
				<summary>{post.comments.length} {post.comments.length === 1 ? 'comment' : 'comments'}</summary>
				<ul>
					{#each post.comments as c (c.id)}
						<li>
							<strong>{c.author.username}</strong>
							<span class="muted">{c.createdAt.slice(0, 16).replace('T', ' ')} UTC</span>
							<p class="body">{c.body}</p>
							{#if form?.kind === 'comment' && form.id === c.id && form.error}
								<p class="error" role="alert">{form.error}</p>
							{/if}
							<details>
								<summary>Delete comment</summary>
								<form method="POST" action="?/deleteComment" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<label class="confirm">
										<input type="checkbox" name="confirm" value="yes" required />
										Confirm: delete this comment.
									</label>
									<button type="submit" class="danger">Delete comment</button>
								</form>
							</details>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</article>
{/each}

{#if data.next}
	<p>
		<a href="{resolve('/admin/moderation')}?before={encodeURIComponent(data.next.before)}&beforeId={data.next.beforeId}">
			Older posts
		</a>
	</p>
{/if}

<style>
	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}
	article {
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.tag {
		padding: 0.05rem 0.5rem;
		font-size: 0.75rem;
		background: #e5e7eb;
		border-radius: 999px;
	}
	.body {
		margin: 0.4rem 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	summary {
		cursor: pointer;
		color: #1d4ed8;
	}
	form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.confirm {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.comments ul {
		padding-left: 0.5rem;
		list-style: none;
	}
	.comments li {
		padding: 0.5rem 0;
		border-top: 1px solid #f3f4f6;
	}
	.ok {
		color: #166534;
	}
	.error {
		margin: 0.4rem 0 0;
		color: #991b1b;
	}
</style>
