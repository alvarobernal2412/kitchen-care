<script lang="ts">
	import { onMount } from 'svelte';
	import type { FeedPost } from '$lib/feedTypes';
	import { timeAgo } from '$lib/relativeTime';
	import { avatarUrl } from '$lib/avatar';
	import Comments from './Comments.svelte';
	import Reactions from './Reactions.svelte';

	let { post, meId }: { post: FeedPost; meId: number } = $props();

	let gone = $state(false);
	let confirming = $state(false);
	let error = $state('');
	let imageBroken = $state(false);
	let img = $state<HTMLImageElement>();

	const initials = (name: string) => name.slice(0, 2).toUpperCase();

	// The proof may have been deleted by an admin; also covers an error that fired before hydration.
	onMount(() => {
		if (img && img.complete && img.naturalWidth === 0) imageBroken = true;
	});

	async function remove() {
		error = '';
		try {
			const res = await fetch(`/api/posts/${post.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) throw new Error(String(res.status));
			gone = true;
		} catch {
			error = 'Could not delete the post.';
			confirming = false;
		}
	}
</script>

{#if !gone}
	<article class:milestone={post.milestone}>
		<header>
			{#if avatarUrl(post.author.avatar)}
				<img class="avatar" src={avatarUrl(post.author.avatar)} alt="" />
			{:else}
				<span class="avatar fallback" aria-hidden="true">{initials(post.author.username)}</span>
			{/if}
			<div class="who">
				<p class="name">
					<strong>{post.author.username}</strong>
					{#if post.author.deactivated}<span class="muted">(deactivated)</span>{/if}
				</p>
				<p class="meta">
					{#if post.author.classification}<span class="chip">{post.author.classification}</span>{/if}
					{#if post.author.department}<span class="chip">{post.author.department}</span>{/if}
					<time datetime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
						{timeAgo(post.createdAt)}
					</time>
				</p>
			</div>
		</header>

		<p class="body">{post.body}</p>

		{#if post.imagePath && !imageBroken}
			<img
				bind:this={img}
				class="proof"
				src={`/media/${post.imagePath}`}
				loading="lazy"
				alt={`Proof photo: ${post.milestone?.taskLabel ?? 'milestone'}`}
				onerror={() => (imageBroken = true)}
			/>
		{/if}

		<Reactions postId={post.id} counts={post.reactions} mine={post.mine} />
		<Comments postId={post.id} count={post.commentCount} {meId} />

		{#if post.author.id === meId}
			<div class="owner">
				{#if confirming}
					<span class="confirm">
						Delete?
						<button type="button" class="mini danger" onclick={remove}>Yes</button>
						<button type="button" class="mini" onclick={() => (confirming = false)}>No</button>
					</span>
				{:else}
					<button type="button" class="mini" onclick={() => (confirming = true)}>Delete post</button>
				{/if}
			</div>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</article>
{/if}

<style>
	article {
		padding: 0.9rem;
		margin-bottom: 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	article.milestone {
		background: #fffbeb;
		border-color: #f59e0b;
	}
	header {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.avatar {
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 700;
		color: #1d4ed8;
		background: #dbeafe;
	}
	.who {
		min-width: 0;
	}
	.name,
	.meta {
		margin: 0;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
		font-size: 0.75rem;
		color: #6b7280;
	}
	.chip {
		padding: 0 0.45rem;
		background: #f3f4f6;
		border-radius: 999px;
	}
	.muted {
		font-size: 0.8rem;
		color: #6b7280;
	}
	.body {
		margin: 0.7rem 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.proof {
		display: block;
		width: 100%;
		max-height: 20rem;
		margin-bottom: 0.7rem;
		object-fit: cover;
		border-radius: 8px;
	}
	.owner {
		margin-top: 0.6rem;
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
		font-size: 0.85rem;
	}
	.error {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: #b91c1c;
	}
</style>
