<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Thumb from '$lib/components/Thumb.svelte';

	let { data, form } = $props();

	const STATUS = {
		approved: { label: 'Approved', cls: '' },
		pending: { label: 'Pending', cls: 'chip-pending' },
		rejected: { label: 'Rejected', cls: 'chip-danger' }
	} as const;
	const statusOf = (s: string) => STATUS[s as keyof typeof STATUS] ?? { label: s, cls: 'chip-neutral' };
</script>

<svelte:head><title>Proof images</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Proof images</h1>
		<p class="sub">Photos sent in for review. Filter by chore, person or period.</p>
	</header>

	<form method="GET" action={resolve('/admin/images')} class="filters" role="search">
		<div class="field">
			<label class="label" for="f-task">Task</label>
			<select id="f-task" name="task" class="select">
				<option value="">All tasks</option>
				{#each data.tasks as t (t.key)}
					<option value={t.key} selected={t.key === data.filters.task}>{t.label}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label class="label" for="f-user">User</label>
			<input
				id="f-user"
				type="text"
				name="user"
				class="input"
				value={data.filters.user}
				maxlength="64"
				autocomplete="off"
			/>
		</div>
		<div class="field">
			<label class="label" for="f-period">Period</label>
			<select id="f-period" name="period" class="select">
				<option value="">All periods</option>
				{#each data.periods as p (p.id)}
					<option value={p.id} selected={p.id === data.filters.period}>
						{p.name}{p.active ? ' (active)' : ''}
					</option>
				{/each}
			</select>
		</div>
		<button type="submit" class="btn btn-primary apply">Apply</button>
	</form>

	{#if data.paged}
		<p class="back"><a href={resolve('/admin/images')}>&larr; Back to newest</a></p>
	{/if}

	{#if data.items.length === 0}
		<p class="empty">No stored proof images match.</p>
	{:else}
		<ul class="grid" aria-label="Proof images">
			{#each data.items as i (i.id)}
				{@const st = statusOf(i.status)}
				<li>
					<Thumb
						src={`/media/${i.imagePath}`}
						href={`/media/${i.imagePath}`}
						alt={`Proof for ${i.taskLabel} by ${i.username}`}
					/>
					<p class="task">{i.taskLabel}</p>
					<p class="who">{i.username}</p>
					<p class="meta">
						<span class="chip {st.cls}">{st.label}</span>
						<span>{i.createdAt.slice(0, 10)}{i.periodName ? `, ${i.periodName}` : ''}</span>
					</p>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.next !== null}
		<p class="more">
			<a class="btn btn-quiet" href="{resolve('/admin/images')}?{data.nextQuery}">Load more</a>
		</p>
	{/if}

	<section class="cleanup" aria-labelledby="cleanup-h">
		<h2 id="cleanup-h">Delete proof images</h2>
		<p class="help">
			Removes the photo files of an ended period. Points, statuses, the leaderboard and winners stay
			as they are. This cannot be undone.
		</p>

		{#if data.periods.length === 0}
			<p class="empty">No periods yet.</p>
		{/if}
		<div class="panels">
			{#each data.periods as p (p.id)}
				{@const mine = form?.periodId === p.id}
				<section class="panel" aria-labelledby="period-{p.id}">
					<h3 id="period-{p.id}">{p.name}</h3>
					{#if mine && form?.error}
						<Notice kind="error" role="alert">{form.error}</Notice>
					{/if}
					{#if mine && form?.removed !== undefined}
						<Notice kind={form.failed ? 'warn' : 'ok'} role="status">
							Removed {form.removed} {form.removed === 1 ? 'image' : 'images'}{form.failed
								? `; ${form.failed} could not be removed (try again or check the server).`
								: '.'}
						</Notice>
					{/if}
					{#if p.active}
						<button type="submit" class="btn btn-danger" disabled aria-describedby="why-{p.id}">
							Delete proof images
						</button>
						<p class="help" id="why-{p.id}">Images of a running period can't be deleted.</p>
					{:else}
						<form method="POST" action="?/deleteImages" use:enhance class="confirm">
							<input type="hidden" name="periodId" value={p.id} />
							<label class="check">
								<input type="checkbox" name="confirm" value="yes" required />
								<span>Confirm: permanently delete all proof photos of {p.name}.</span>
							</label>
							<button type="submit" class="btn btn-danger">Delete proof images</button>
						</form>
					{/if}
				</section>
			{/each}
		</div>
	</section>
</div>

<style>
	.filters {
		display: grid;
		gap: var(--sp-3);
		margin-bottom: var(--sp-5);
	}
	.apply {
		justify-self: start;
		min-width: 120px;
	}
	.back {
		margin-bottom: var(--sp-3);
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--sp-4) var(--sp-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.grid li {
		display: grid;
		gap: 4px;
		align-content: start;
		min-width: 0;
	}
	.grid li > :global(.thumb) {
		margin-bottom: 4px;
	}
	.task {
		font-weight: 600;
		font-size: var(--fs-ui);
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.who {
		font-size: var(--fs-small);
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--sp-2);
		margin-top: 2px;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.more {
		margin-top: var(--sp-5);
	}
	.more a {
		width: 100%;
	}

	.cleanup {
		margin-top: var(--sp-7);
		padding-top: var(--sp-5);
		border-top: 1px solid var(--line);
	}
	.cleanup .help {
		margin-top: var(--sp-2);
	}
	.panels {
		display: grid;
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}
	.panel {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
		padding: var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-ctl);
		background: var(--surface);
	}
	.panel > :global(.notice) {
		justify-self: stretch;
	}
	.panel h3 {
		font-size: 18px;
		line-height: 1.2;
	}
	.confirm {
		display: grid;
		gap: var(--sp-1);
		justify-items: start;
	}

	@media (min-width: 900px) {
		.filters {
			grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
			align-items: end;
		}
		.grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: var(--sp-5) var(--sp-4);
		}
		.more a {
			width: auto;
		}
	}
</style>
