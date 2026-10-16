<script lang="ts">
	import { EMOJIS, reactionLabel, type Emoji } from '$lib/emoji';
	import { IconCheck } from '$lib/icons';

	let {
		postId,
		counts,
		mine
	}: { postId: number; counts: Record<Emoji, number>; mine: Emoji[] } = $props();

	// Local optimistic copy; the props only seed it.
	// svelte-ignore state_referenced_locally
	let current = $state({ ...counts });
	// svelte-ignore state_referenced_locally
	let own = $state<Emoji[]>([...mine]);
	let error = $state('');

	// One request at a time per post: chips are disabled while it is in flight, so responses
	// cannot arrive out of order and a rollback always restores the right snapshot.
	let pending = $state(false);

	async function toggle(emoji: Emoji) {
		if (pending) return;
		pending = true;
		const prevCounts = { ...current };
		const prevOwn = [...own];
		const on = own.includes(emoji);
		// Optimistic update
		current[emoji] = Math.max(0, current[emoji] + (on ? -1 : 1));
		own = on ? own.filter((e) => e !== emoji) : [...own, emoji];
		error = '';
		try {
			const res = await fetch(`/api/posts/${postId}/reactions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ emoji })
			});
			if (!res.ok) throw new Error(String(res.status));
			const server: { counts: Record<Emoji, number>; mine: Emoji[] } = await res.json();
			current = server.counts;
			own = server.mine;
		} catch {
			current = prevCounts;
			own = prevOwn;
			error = 'Could not save your reaction. Try again.';
		} finally {
			pending = false;
		}
	}
</script>

<div class="bar" role="group" aria-label="Reactions">
	{#each EMOJIS as emoji (emoji)}
		{@const on = own.includes(emoji)}
		<button
			type="button"
			class="react"
			class:on
			aria-pressed={on}
			aria-label={reactionLabel(emoji, current[emoji])}
			disabled={pending}
			onclick={() => toggle(emoji)}
		>
			<span class="e" aria-hidden="true">{emoji}</span>
			{#if current[emoji] > 0}<span class="n" aria-hidden="true">{current[emoji]}</span>{/if}
			{#if on}<IconCheck size={14} class="tick" />{/if}
		</button>
	{/each}
</div>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.react {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-1);
		width: auto;
		min-width: 44px;
		min-height: 44px;
		padding: 0 var(--sp-3);
		border: 1px solid var(--line);
		border-radius: var(--r-chip);
		background: transparent;
		color: var(--ink);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-press);
	}
	.react:hover:not(:disabled) {
		background: var(--recess);
	}
	.react:active:not(:disabled) {
		transform: scale(0.95);
	}
	.react:disabled {
		opacity: 1;
		cursor: progress;
	}
	.react.on,
	.react.on:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--accent-wash);
		color: var(--accent-ink);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.e {
		font-size: 17px;
		line-height: 1;
	}
	.n {
		font-variant-numeric: tabular-nums;
	}
	.react :global(.tick) {
		flex: none;
	}
	.error {
		margin-top: var(--sp-2);
		color: var(--danger);
		font-size: var(--fs-small);
	}
</style>
