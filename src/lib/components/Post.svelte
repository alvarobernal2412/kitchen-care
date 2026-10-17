<script lang="ts">
	import { onMount } from 'svelte';
	import type { FeedPost } from '$lib/feedTypes';
	import { avatarUrl } from '$lib/avatar';
	import Avatar from './Avatar.svelte';
	import Comments from './Comments.svelte';
	import Reactions from './Reactions.svelte';
	import RelativeTime from './RelativeTime.svelte';

	let { post, meId }: { post: FeedPost; meId: number } = $props();

	let gone = $state(false);
	let confirming = $state(false);
	let error = $state('');
	let imageBroken = $state(false);
	let imageLoaded = $state(false);
	let img = $state<HTMLImageElement>();

	// The proof may have been deleted by an admin; also covers an event that fired before hydration.
	onMount(() => {
		if (img?.complete) {
			if (img.naturalWidth === 0) imageBroken = true;
			else imageLoaded = true;
		}
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
			<Avatar
				name={post.author.username}
				src={avatarUrl(post.author.avatar)}
				seed={post.author.id}
				size={40}
			/>
			<div class="who">
				<p class="name">
					<b>{post.author.username}</b>
					{#if post.author.deactivated}<span class="muted">(left)</span>{/if}
				</p>
				<p class="meta">
					{#if post.author.classification}<span>{post.author.classification}</span>{/if}
					{#if post.author.department}<span>{post.author.department}</span>{/if}
					<RelativeTime iso={post.createdAt} />
				</p>
			</div>
		</header>

		<h2 class={post.milestone ? 'headline' : 'title'}>{post.title}</h2>
		{#if post.body}
			<p class="body">{post.body}</p>
		{/if}

		{#if post.imagePath && !imageBroken}
			<div class="photo">
				{#if !imageLoaded}<span class="skeleton shim" aria-hidden="true"></span>{/if}
				<img
					bind:this={img}
					src={`/media/${post.imagePath}`}
					loading="lazy"
					alt={`Proof photo: ${post.milestone?.taskLabel ?? 'milestone'}`}
					onload={() => (imageLoaded = true)}
					onerror={() => (imageBroken = true)}
				/>
			</div>
		{/if}

		<div class="reacts">
			<Reactions postId={post.id} counts={post.reactions} mine={post.mine} />
		</div>
		<Comments postId={post.id} count={post.commentCount} {meId} />

		{#if post.author.id === meId}
			<div class="owner">
				{#if confirming}
					<span class="confirm">
						Delete?
						<button type="button" class="act danger" onclick={remove}>Yes</button>
						<button type="button" class="act" onclick={() => (confirming = false)}>No</button>
					</span>
				{:else}
					<button type="button" class="act" onclick={() => (confirming = true)}>Delete post</button>
				{/if}
			</div>
		{/if}
		{#if error}<p class="err" role="alert">{error}</p>{/if}
	</article>
{/if}

<style>
	article {
		padding: var(--sp-5) 0 var(--sp-2);
		border-top: 1px solid var(--line);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.who {
		min-width: 0;
	}
	.name {
		font-size: var(--fs-ui);
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.name b {
		font-weight: 600;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--sp-2);
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.title {
		max-width: none;
		margin-top: var(--sp-3);
		font: 700 19px / 1.2 var(--font-display);
		letter-spacing: -0.015em;
		overflow-wrap: anywhere;
	}
	.title + .body {
		margin-top: var(--sp-1);
	}
	.body {
		max-width: none;
		margin-top: var(--sp-3);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.headline {
		max-width: none;
		margin-top: var(--sp-3);
		font: 700 24px / 1.12 var(--font-display);
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.headline + .body {
		margin-top: var(--sp-2);
	}
	.photo {
		position: relative;
		overflow: hidden;
		aspect-ratio: 4 / 3;
		margin-top: var(--sp-3);
		border-radius: 10px;
		background: var(--photo);
	}
	.shim {
		position: absolute;
		inset: 0;
		border-radius: 0;
	}
	.photo img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.reacts {
		margin-top: var(--sp-3);
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
	.owner {
		margin-left: calc(var(--sp-3) * -1);
	}
	.confirm {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		padding-left: var(--sp-3);
		font-size: var(--fs-small);
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-small);
	}
</style>
