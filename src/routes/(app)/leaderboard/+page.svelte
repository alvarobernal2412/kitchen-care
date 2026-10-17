<script lang="ts">
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { avatarUrl } from '$lib/avatar';
	import { ordinal } from '$lib/ordinal';

	let { data } = $props();

	const PRIZE = 'The group chips in for a prize for the top contributors.';
	const sub = $derived(data.period ? `${data.period.name}. ${PRIZE}` : PRIZE);

	const groups = [
		{ value: 'all', label: 'All', href: '/leaderboard' },
		{ value: 'students', label: 'Students', href: '/leaderboard?group=students' },
		{ value: 'employees', label: 'Employees', href: '/leaderboard?group=employees' }
	];

	const tiedRanks = $derived.by(() => {
		const counts: Record<number, number> = {};
		for (const r of data.rows) counts[r.rank] = (counts[r.rank] ?? 0) + 1;
		return new Set(data.rows.filter((r) => counts[r.rank] > 1).map((r) => r.rank));
	});

	/** "Employee, Interactions Research Group" (department only for employees). */
	function meta(r: (typeof data.rows)[number]): string {
		const parts: string[] = [];
		if (r.classification) parts.push(r.classification);
		if (r.department) parts.push(r.department);
		return parts.join(', ');
	}
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<div class="page">
	<header>
		<h1>Leaderboard</h1>
		<p class="sub">{sub}</p>
		<p class="past"><a href={resolve('/history')}>Past periods</a></p>
	</header>

	<div class="filters">
		<Segmented options={groups} value={data.group} name="group" ariaLabel="Filter by group" />
		{#if data.group === 'employees'}
			<form method="GET" class="dept">
				<input type="hidden" name="group" value="employees" />
				<label class="label" for="dept">Department</label>
				<div class="dept-row">
					<select id="dept" name="dept" class="select" value={data.dept}>
						<option value="">All departments</option>
						{#each data.departments as d (d)}
							<option value={d}>{d}</option>
						{/each}
					</select>
					<button type="submit" class="btn btn-quiet apply">Apply</button>
				</div>
			</form>
		{/if}
	</div>

	{#if !data.period}
		<p class="empty">No active period right now.</p>
	{:else if data.rows.length === 0}
		<p class="empty">Nobody has credits yet. Log a chore to start the board.</p>
	{:else}
		<ol class="board">
			{#each data.rows as row (row.userId)}
				{@const me = row.userId === data.meId}
				<li class:lead={row.rank === 1} class:me aria-current={me ? 'true' : undefined}>
					<span class="rank">{row.rank}</span>
					<Avatar
						name={row.username}
						src={avatarUrl(row.avatar)}
						seed={row.userId}
						size={row.rank === 1 ? 48 : 40}
					/>
					<span class="who">
						<span class="line">
							<span class="name">{row.username}</span>
							{#if me}<span class="chip you">you</span>{/if}
							{#if tiedRanks.has(row.rank)}<span class="chip chip-neutral tie">tied for {ordinal(row.rank)}</span>{/if}
						</span>
						<span class="meta">{meta(row)}</span>
					</span>
					<span class="pts">{row.points}<span class="visually-hidden"> points</span></span>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.page {
		padding: var(--sp-5) 0 var(--sp-6);
	}
	header h1 {
		font-size: var(--fs-h1);
	}
	.sub {
		margin-top: var(--sp-2);
		color: var(--muted);
		font-size: var(--fs-ui);
	}
	.past {
		margin-top: var(--sp-1);
		font-size: var(--fs-ui);
	}
	.past a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.filters {
		margin: var(--sp-2) 0 var(--sp-5);
	}
	.dept {
		margin-top: var(--sp-3);
	}
	.dept-row {
		display: flex;
		gap: var(--sp-2);
		margin-top: 6px;
	}
	.dept .select {
		flex: 1;
		min-width: 0;
	}
	.apply {
		width: auto;
		flex: none;
	}

	.board {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 2px solid var(--accent);
	}
	li {
		display: grid;
		grid-template-columns: 36px 40px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-3);
		min-height: 64px;
		border-bottom: 1px solid var(--line);
	}
	li.lead {
		grid-template-columns: 36px 48px minmax(0, 1fr) auto;
		min-height: 92px;
	}
	li.me {
		margin: 6px -8px;
		padding: 0 8px;
		border-bottom: 0;
		border-radius: var(--r-ctl);
		background: var(--accent-wash);
	}
	.rank {
		padding-left: 4px;
		color: var(--muted);
		font: 600 17px / 1 var(--font-body);
	}
	li.lead .rank {
		padding-left: 0;
		color: var(--accent-ink);
		font: 800 48px / 0.9 var(--font-display);
		letter-spacing: -0.03em;
	}
	li.me .rank {
		color: var(--accent-ink);
		font-weight: 700;
	}
	.who {
		display: block;
		min-width: 0;
	}
	.line {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-body);
		font-weight: 500;
		line-height: 1.2;
	}
	li.me .name {
		font-weight: 600;
	}
	li.lead .name {
		font: 700 20px / 1.1 var(--font-display);
		letter-spacing: -0.02em;
	}
	.tie {
		flex: none;
	}
	.you {
		flex: none;
		background: var(--accent);
		color: var(--on-accent);
	}
	.meta {
		display: block;
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.pts {
		justify-self: end;
		font: 700 24px / 1 var(--font-display);
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	li.lead .pts {
		font-size: 40px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.empty {
		padding: var(--sp-5) 0;
		border-top: 2px solid var(--accent);
		color: var(--muted);
	}

	@media (min-width: 900px) {
		.page {
			padding-top: var(--sp-6);
		}
		.board,
		.filters,
		header {
			max-width: 640px;
		}
		li.lead .name {
			font-size: 22px;
		}
		li.lead .pts {
			font-size: 44px;
		}
	}
</style>
