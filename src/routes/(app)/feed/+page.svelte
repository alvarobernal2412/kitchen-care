<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Post from '$lib/components/Post.svelte';

	let { data, form } = $props();

	let draft = $state('');
	let sending = $state(false);
	// Without JavaScript the button stays enabled so the server can answer an empty post inline.
	let mounted = $state(false);
	onMount(() => (mounted = true));
	// Restore the text after a no-JS failed submit.
	// svelte-ignore state_referenced_locally
	if (form?.body) draft = form.body;

	const length = $derived([...draft].length);
	const left = $derived(data.postMax - length);
	// Announced politely, and only when the limit is close, so typing is not read out per key.
	const status = $derived(
		left < 0
			? `${-left} characters over the limit`
			: left <= 50
				? `${left} characters left`
				: ''
	);
	const describedBy = $derived(form?.error ? 'compose-count compose-error' : 'compose-count');
</script>

<svelte:head><title>Feed</title></svelte:head>

<div class="page">
	<h1>Feed</h1>

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
			<label class="label" for="compose-body">Share something with the kitchen</label>
			<textarea
				id="compose-body"
				name="body"
				class="input"
				rows="3"
				maxlength={data.postMax}
				aria-describedby={describedBy}
				aria-invalid={form?.error ? 'true' : undefined}
				bind:value={draft}
			></textarea>
			<div class="actions">
				<span id="compose-count" class="help" class:over={left < 0}>{length}/{data.postMax}</span>
				<button type="submit" class="btn btn-primary post" disabled={sending || (mounted && !draft.trim())}>
					Post
				</button>
			</div>
			<p class="visually-hidden" role="status" aria-live="polite">{status}</p>
			{#if form?.error}<p id="compose-error" class="error" role="alert">{form.error}</p>{/if}
		</form>
	{:else}
		<p class="back"><a href={resolve('/feed')}>&larr; Back to newest</a></p>
	{/if}

	<div class="stream">
		{#if data.posts.length === 0}
			<p class="empty">Nothing here yet. Post something or log a chore.</p>
		{/if}

		{#each data.posts as post (post.id)}
			<Post {post} meId={data.meId} />
		{/each}
	</div>

	{#if data.next}
		<form method="GET" class="more">
			<input type="hidden" name="before" value={data.next.before} />
			<input type="hidden" name="beforeId" value={data.next.beforeId} />
			<button type="submit" class="btn btn-quiet">Load more</button>
		</form>
	{/if}
</div>

<style>
	.page {
		padding: var(--sp-5) 0 var(--sp-6);
	}
	h1 {
		font-size: var(--fs-h1);
	}
	.compose {
		display: grid;
		gap: 6px;
		margin-top: var(--sp-4);
		padding: var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-ctl);
		background: var(--surface);
	}
	.compose textarea {
		resize: vertical;
		background: var(--ground);
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		margin-top: 2px;
	}
	.over {
		color: var(--danger);
		font-weight: 600;
	}
	.post {
		width: auto;
	}
	.compose .error {
		margin: 0;
	}
	.back {
		margin-top: var(--sp-2);
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.stream {
		margin-top: var(--sp-5);
		border-bottom: 1px solid var(--line);
	}
	.stream:has(.empty) {
		border-bottom: 0;
	}
	.empty {
		padding: var(--sp-5) 0;
		border-top: 1px solid var(--line);
		color: var(--muted);
	}
	.more {
		margin-top: var(--sp-4);
	}
	.more .btn {
		width: 100%;
	}

	@media (min-width: 900px) {
		.page {
			max-width: 600px;
			padding-top: var(--sp-6);
		}
		.more .btn {
			width: auto;
		}
	}
</style>
