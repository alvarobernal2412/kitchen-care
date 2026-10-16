<script lang="ts">
	import { EMOJIS, reactionLabel, type Emoji } from '$lib/emoji';

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
		<button
			type="button"
			class="chip"
			class:on={own.includes(emoji)}
			aria-pressed={own.includes(emoji)}
			aria-label={reactionLabel(emoji, current[emoji])}
			disabled={pending}
			onclick={() => toggle(emoji)}
		>
			<span aria-hidden="true">{emoji}</span>
			<span class="n">{current[emoji]}</span>
		</button>
	{/each}
</div>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		width: auto;
		padding: 0.3rem 0.6rem;
		font-weight: 500;
		color: #374151;
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 999px;
	}
	.chip.on {
		color: #1d4ed8;
		background: #eff6ff;
		border-color: #1d4ed8;
	}
	.n {
		min-width: 0.6rem;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.error {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: #b91c1c;
	}
</style>
