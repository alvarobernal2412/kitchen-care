<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarUrl } from '$lib/avatar';
	import { shortAgo } from '$lib/relativeTime';

	type Item = {
		id: number;
		username: string;
		avatarPath: string | null;
		taskKey: string;
		taskLabel: string;
		at: string;
	};

	let { items, now }: { items: Item[]; now: number } = $props();

	const PHRASE: Record<string, string> = {
		cutlery: 'logged cutlery',
		dishwasher: 'logged dishwasher',
		grounds: 'logged coffee grounds',
		milk: 'brought milk',
		beans: 'brought coffee beans',
		descale: 'descaled the machine',
		deep_clean: 'deep cleaned'
	};
	const phrase = (i: Item) => PHRASE[i.taskKey] ?? `logged ${i.taskLabel.toLowerCase()}`;
</script>

{#if items.length === 0}
	<p class="empty">Nothing logged yet this period. Be the first.</p>
{:else}
	<ol class="feed">
		{#each items as item (item.id)}
			<li>
				<Avatar name={item.username} src={avatarUrl(item.avatarPath)} size={32} />
				<span class="what"><b class="user">{item.username}</b><span class="act">{phrase(item)}</span></span>
				<time datetime={item.at}>{shortAgo(item.at, now)}</time>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.feed {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-3);
		min-height: 56px;
		border-top: 1px solid var(--line);
		font-size: 14px;
		line-height: 1.35;
	}
	.what {
		display: flex;
		gap: 0.3em;
		min-width: 0;
	}
	/* only the name gives way; the action and the time stay readable */
	.user {
		min-width: 4ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.act {
		flex: none;
		white-space: nowrap;
	}
	time {
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.empty {
		padding-top: var(--sp-3);
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-size: 14px;
	}
</style>
