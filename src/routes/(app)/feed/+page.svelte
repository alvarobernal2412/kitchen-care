<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Post from '$lib/components/Post.svelte';

	let { data, form } = $props();

	let draft = $state('');
	let sending = $state(false);
	// Restore the text after a no-JS failed submit.
	// svelte-ignore state_referenced_locally
	if (form?.body) draft = form.body;

</script>

<svelte:head><title>Feed</title></svelte:head>

<h2>Feed</h2>

{#if !data.paged}
	<form
		method="POST"
		action="?/post"
		class="compose"
		use:enhance={() => {
			sending = true;
			return async ({ result, update }) => {
				if (result.type === 'success') draft = '';
				await update({ reset: false });
				sending = false;
			};
		}}
	>
		<label class="sr" for="compose-body">Share something with the kitchen</label>
		<textarea
			id="compose-body"
			name="body"
			rows="3"
			maxlength={data.postMax}
			placeholder="Share something with the kitchen…"
			bind:value={draft}
		></textarea>
		<div class="row">
			<small class="muted">{[...draft].length}/{data.postMax}</small>
			<button type="submit" disabled={sending || !draft.trim()}>Post</button>
		</div>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	</form>
{:else}
	<p><a href={resolve('/feed')}>&larr; Back to newest</a></p>
{/if}

{#if data.posts.length === 0}
	<p class="muted">Nothing here yet. Be the first to post!</p>
{/if}

{#each data.posts as post (post.id)}
	<Post {post} meId={data.meId} />
{/each}

{#if data.next}
	<form method="GET" class="more">
		<input type="hidden" name="before" value={data.next.before} />
		<input type="hidden" name="beforeId" value={data.next.beforeId} />
		<button type="submit">Load more</button>
	</form>
{/if}

<style>
	.muted {
		color: #6b7280;
	}
	.compose {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		padding: 0.6rem;
		font: inherit;
		resize: vertical;
		border: 1px solid #d1d5db;
		border-radius: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.row button {
		width: auto;
		padding: 0.5rem 1.5rem;
	}
	.error {
		margin: 0;
		color: #b91c1c;
	}
	.more {
		margin-top: 1rem;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
