<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { avatarUrl } from '$lib/avatar';
	import Avatar from '$lib/components/Avatar.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import RelativeTime from '$lib/components/RelativeTime.svelte';
	import Thumb from '$lib/components/Thumb.svelte';

	let { data, form } = $props();

	// The filters ride along on the removal so the page comes back the way the admin left it,
	// with or without JavaScript.
	const removeAction = $derived(`?/revoke${data.query ? `&${data.query}` : ''}`);
</script>

<svelte:head><title>Activity</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Activity</h1>
		<p class="sub">
			Approved chores of the running period. If a check was wrong, remove its points here; the
			chore then counts nowhere and the person can log it again.
		</p>
	</header>

	{#if form?.error && !form.submissionId}
		<Notice kind="error" role="alert">{form.error}</Notice>
	{/if}
	{#if form?.removed}
		<Notice kind="ok" role="status">Points removed. That chore no longer counts.</Notice>
	{/if}

	{#if !data.period}
		<p class="empty">No period is running.</p>
	{:else}
		<form method="GET" action={resolve('/admin/activity')} class="filters" role="search">
			<div class="field">
				<label class="label" for="f-user">Person</label>
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
				<label class="label" for="f-task">Chore</label>
				<select id="f-task" name="task" class="select">
					<option value="">All chores</option>
					{#each data.tasks as t (t.key)}
						<option value={t.key} selected={t.key === data.filters.task}>{t.label}</option>
					{/each}
				</select>
			</div>
			<label class="check removed-toggle">
				<input type="checkbox" name="removed" value="1" checked={data.filters.removed} />
				<span>Show removed</span>
			</label>
			<button type="submit" class="btn btn-primary apply">Apply</button>
		</form>

		{#if data.paged}
			<p class="back"><a href={resolve('/admin/activity')}>&larr; Back to newest</a></p>
		{/if}

		{#if data.items.length === 0}
			<p class="empty">Nothing to review. Approved chores of the running period show up here.</p>
		{:else}
			<ul class="rows" aria-label="Approved chores in {data.period.name}">
				{#each data.items as item (item.id)}
					{@const failed = form?.error && form.submissionId === item.id}
					<li class="a" class:gone={item.status === 'revoked'}>
						<div class="main">
							<Avatar
								name={item.username}
								src={avatarUrl(item.avatarPath)}
								seed={item.userId}
								size={40}
							/>
							<div class="what">
								<p class="who"><b>{item.username}</b></p>
								<p class="chore">{item.taskLabel}</p>
								<p class="meta">
									<span class="chip" class:chip-neutral={item.status === 'revoked'}>
										{#if item.status === 'revoked'}Removed{:else}+{item.points}
											<span class="visually-hidden">{item.points === 1 ? ' credit' : ' credits'}</span>{/if}
									</span>
									<RelativeTime iso={item.createdAt} />
								</p>
							</div>
							{#if item.imagePath}
								<div class="proof">
									<Thumb
										src={`/media/${item.imagePath}`}
										href={`/media/${item.imagePath}`}
										alt={`Proof for ${item.taskLabel} by ${item.username}`}
									/>
								</div>
							{/if}
						</div>

						{#if item.status === 'revoked'}
							<p class="removed">
								Removed by {item.revokedByUsername ?? 'an admin'}: {item.revokeReason ?? 'no reason given'}
							</p>
						{:else}
							<details class="acts" open={failed ? true : undefined}>
								<summary class="btn btn-quiet"
									>Remove points<span class="visually-hidden"> of {item.username} for {item.taskLabel}</span
									></summary
								>
								<form method="POST" action={removeAction} use:enhance class="remove">
									<input type="hidden" name="submissionId" value={item.id} />
									{#if failed}
										<Notice kind="error" role="alert" id="err-{item.id}">{form?.error}</Notice>
									{/if}
									<label class="label" for="why-{item.id}">Reason (the person sees it)</label>
									<textarea
										id="why-{item.id}"
										name="reason"
										class="input"
										rows="2"
										maxlength="200"
										required
										aria-describedby={failed ? `err-${item.id}` : undefined}
									></textarea>
									<label class="check">
										<input type="checkbox" name="confirm" value="yes" required />
										<span>I'm sure<span class="visually-hidden">, remove {item.points} {item.points === 1 ? 'credit' : 'credits'} from {item.username}</span></span>
									</label>
									<button type="submit" class="btn btn-danger">Remove points</button>
								</form>
							</details>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.next !== null}
			<p class="more">
				<a class="btn btn-quiet" href="{resolve('/admin/activity')}?{data.nextQuery}">Load older</a>
			</p>
		{/if}
	{/if}
</div>

<style>
	.filters {
		display: grid;
		gap: var(--sp-3);
		margin-bottom: var(--sp-5);
	}
	.removed-toggle {
		padding: 0;
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
	.a {
		display: grid;
		gap: var(--sp-3);
	}
	.main {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr);
		gap: var(--sp-3);
		align-items: start;
	}
	.what {
		min-width: 0;
	}
	.who {
		max-width: none;
		overflow-wrap: anywhere;
	}
	.chore {
		max-width: none;
		overflow-wrap: anywhere;
		font-size: var(--fs-ui);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-1) var(--sp-2);
		max-width: none;
		margin-top: 4px;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.proof {
		grid-column: 2;
		max-width: 220px;
	}
	.gone .who b,
	.gone .chore {
		color: var(--muted);
	}
	.removed {
		max-width: none;
		padding: var(--sp-3);
		border-radius: var(--r-ctl);
		background: var(--recess);
		color: var(--ink);
		font-size: var(--fs-small);
		overflow-wrap: anywhere;
	}
	.acts summary {
		display: inline-flex;
		list-style: none;
	}
	.acts summary::-webkit-details-marker {
		display: none;
	}
	.remove {
		display: grid;
		gap: var(--sp-2);
		justify-items: start;
		margin-top: var(--sp-3);
		padding-top: var(--sp-3);
		border-top: 1px solid var(--line);
	}
	.remove > :global(.notice),
	.remove .input {
		justify-self: stretch;
	}
	.remove .label {
		color: var(--muted);
		font-size: 13px;
		font-weight: 400;
	}
	.more {
		margin-top: var(--sp-5);
	}
	.more a {
		width: 100%;
	}

	@media (min-width: 900px) {
		.filters {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
			align-items: end;
		}
		.a {
			grid-template-columns: minmax(0, 1fr) 280px;
			align-items: start;
			gap: var(--sp-5);
		}
		.main {
			grid-template-columns: 40px minmax(0, 1fr) 120px;
		}
		.proof {
			grid-column: 3;
		}
		.more a {
			width: auto;
		}
	}
</style>
