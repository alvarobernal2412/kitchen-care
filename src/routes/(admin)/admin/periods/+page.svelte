<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { avatarUrl } from '$lib/avatar';
	import Avatar from '$lib/components/Avatar.svelte';
	import Notice from '$lib/components/Notice.svelte';

	let { data, form } = $props();

	const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
	const people = (n: number) => `${n} ${n === 1 ? 'scoring participant' : 'scoring participants'}`;
	const createFailed = $derived(form?.action === 'create' && form.error);
</script>

<svelte:head><title>Periods</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Periods</h1>
		<p class="sub">One period runs at a time. Ending it records the winners.</p>
	</header>

	{#if form?.action === 'end' && !form.error}
		<Notice kind="ok" role="status">
			Period ended. {form.winnerCount === 0
				? 'Nobody scored, so there are no winners.'
				: 'Winners recorded (see below).'}
		</Notice>
	{/if}
	{#if form?.action === 'create' && !form.error}
		<Notice kind="ok" role="status">Period "{form.created}" started.</Notice>
	{/if}

	{#if data.active}
		<section class="panel" aria-labelledby="end-h">
			<h2 id="end-h">End {data.active.name}</h2>
			{#if data.active.pending > 0}
				<Notice kind="warn" role="status">
					<p>
						{data.active.pending}
						{data.active.pending === 1 ? 'submission' : 'submissions'} still pending review. They can only
						be rejected after the period ends.
					</p>
					<p class="link"><a href={resolve('/admin/review')}>Open the review queue</a></p>
				</Notice>
			{/if}
			<form method="POST" action="?/end" use:enhance class="form">
				<input type="hidden" name="periodId" value={data.active.id} />
				<label class="check">
					<input type="checkbox" name="confirm" value="yes" required />
					<span>I understand this ends the period now, records the winners, and cannot be undone.</span>
				</label>
				{#if form?.action === 'end' && form.error}
					<Notice kind="error" role="alert">{form.error}</Notice>
				{/if}
				<button type="submit" class="btn btn-danger">End period</button>
			</form>
		</section>
	{:else}
		<section class="panel" aria-labelledby="start-h">
			<h2 id="start-h">Start a new period</h2>
			<form method="POST" action="?/create" use:enhance class="form">
				<div class="field">
					<label class="label" for="period-name">Period name</label>
					<input
						id="period-name"
						type="text"
						name="name"
						class="input"
						required
						maxlength="80"
						placeholder="e.g. November 2026"
						autocomplete="off"
						value={createFailed ? (form?.name ?? '') : ''}
						aria-invalid={createFailed ? 'true' : undefined}
						aria-describedby={createFailed ? 'create-error' : undefined}
					/>
				</div>
				{#if createFailed}
					<Notice kind="error" role="alert" id="create-error">{form?.error}</Notice>
				{/if}
				<button type="submit" class="btn btn-primary">Create period</button>
			</form>
		</section>
	{/if}

	<h2 class="list-h">All periods</h2>
	{#if !data.active && data.past.length === 0}
		<p class="empty">No periods yet.</p>
	{:else}
		<ul class="rows" aria-label="Periods">
			{#if data.active}
				<li class="p">
					<div class="top">
						<h3>{data.active.name}</h3>
						<span class="chip">Active</span>
					</div>
					<p class="meta">
						Started {day(data.active.startsAt)} &middot; {people(data.active.participants)}
					</p>
				</li>
			{/if}
			{#each data.past as p (p.id)}
				<li class="p">
					<div class="top">
						<h3>{p.name}</h3>
						<span class="chip chip-neutral">Ended</span>
					</div>
					<p class="meta">
						{day(p.startsAt)} to {day(p.endsAt)} &middot; {people(p.participants)}
					</p>
					{#if p.winners.length === 0}
						<p class="meta">No winners</p>
					{:else}
						<div class="win">
							<p class="meta">{p.winners.length > 1 ? 'Winners' : 'Winner'}</p>
							{#if p.winners.length > 1}<span class="chip chip-neutral">Tied</span>{/if}
						</div>
						<ul class="winners">
							{#each p.winners as w (w.userId)}
								<li>
									<Avatar name={w.username} src={avatarUrl(w.avatarPath)} seed={w.userId} size={28} />
									<span class="wname">{w.username}</span>
									<span class="num wpts">{w.points} pts</span>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.panel {
		display: grid;
		gap: var(--sp-4);
		margin-bottom: var(--sp-6);
		padding: var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-tile);
		background: var(--surface);
	}
	.panel h2 {
		font-size: 20px;
	}
	.form {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
	}
	.form .field {
		justify-self: stretch;
	}
	.form > :global(.notice) {
		justify-self: stretch;
	}
	.link {
		margin-top: var(--sp-2);
	}
	.link a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: inherit;
		font-weight: 600;
	}
	.list-h {
		margin-bottom: var(--sp-3);
	}
	.p {
		display: grid;
		gap: var(--sp-2);
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-2) var(--sp-3);
	}
	.top h3 {
		font-size: 18px;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.meta {
		color: var(--muted);
		font-size: var(--fs-ui);
	}
	.win {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		margin-top: var(--sp-1);
	}
	.winners {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.winners li {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.wname {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.wpts {
		color: var(--muted);
	}

	@media (min-width: 900px) {
		.panel {
			max-width: 560px;
			padding: var(--sp-5);
		}
		.winners {
			flex-direction: row;
			flex-wrap: wrap;
			gap: var(--sp-2) var(--sp-5);
		}
	}
</style>
