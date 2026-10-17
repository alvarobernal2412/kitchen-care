<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { IconCheck, IconClose, IconWarning } from '$lib/icons';
	import { formatBytes, formatDuration, formatMs, formatPercent } from '$lib/systemFormat';
	import Metric from './Metric.svelte';

	let { data } = $props();
	const snap = $derived(data.snapshot);
	const o = $derived(snap.overall);

	const BIG = {
		ok: { word: 'OK', cls: '', Icon: IconCheck },
		attention: { word: 'Attention', cls: 'chip-pending', Icon: IconWarning },
		critical: { word: 'Critical', cls: 'chip-danger', Icon: IconClose }
	} as const;
	const big = $derived(BIG[o.level]);
	const summary = $derived(
		o.level === 'ok' && o.reasons.length === 0
			? 'Everything looks fine.'
			: o.level === 'ok'
				? 'Nothing is wrong, but some figures are missing.'
				: o.level === 'attention'
					? 'Keep an eye on this.'
					: 'Needs action now.'
	);

	const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
	const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'n/a');
	const count = (n: number) => n.toLocaleString('en-GB');

	// Refresh: a plain link that works without JavaScript; with JavaScript it reloads in place.
	let busy = $state(false);
	async function refresh(e: MouseEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		try {
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	let mounted = $state(false);
	let auto = $state(false);
	onMount(() => {
		mounted = true;
	});
	// Cleared when the toggle goes off and when the page is destroyed. Hidden tabs skip a beat.
	$effect(() => {
		if (!auto) return;
		const id = setInterval(() => {
			if (!document.hidden) void invalidateAll();
		}, data.refreshSeconds * 1000);
		return () => clearInterval(id);
	});

	// Polite announcement after a refresh (never on first render).
	let live = $state('');
	let lastSeen: string | null = null;
	$effect(() => {
		const at = data.updatedAt;
		if (lastSeen !== null && lastSeen !== at) live = `Updated at ${at}.`;
		lastSeen = at;
	});

	const dbOk = $derived(snap.database && snap.database.reachable ? snap.database : null);
</script>

<svelte:head><title>System</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>System</h1>
		<p class="sub">Is the app stable, and safe for the VPS? Read-only.</p>
	</header>

	<section class="overall" aria-labelledby="h-overall">
		<h2 id="h-overall" class="visually-hidden">Overall status</h2>
		<p class="verdict">
			<span class="chip big {big.cls}" data-testid="overall-chip"
				><big.Icon size={18} />{big.word}</span
			>
			<span>{summary}</span>
		</p>
		{#if o.reasons.length > 0}
			<ul class="reasons" aria-label="Reasons">
				{#each o.reasons as reason (reason)}
					<li>{reason}</li>
				{/each}
			</ul>
		{/if}
		<div class="tools">
			<a class="btn btn-quiet" href={resolve('/admin/system')} onclick={refresh} aria-busy={busy}>
				Refresh
			</a>
			{#if mounted}
				<label class="auto" data-interval-seconds={data.refreshSeconds}>
					<input type="checkbox" bind:checked={auto} />
					<span>Auto-refresh every {data.refreshSeconds} s</span>
				</label>
			{/if}
			<p class="updated">Updated <time datetime={snap.generatedAt}>{data.updatedAt}</time></p>
		</div>
		<p class="visually-hidden" role="status" aria-live="polite">{live}</p>
	</section>

	<section aria-labelledby="h-disk">
		<h2 id="h-disk">Disk</h2>
		<p class="help">The VPS filesystem that holds the photos.</p>
		{#if snap.disk}
			{@const d = snap.disk}
			<ul class="rows">
				<Metric label="Total" value={formatBytes(d.totalBytes)} />
				<Metric
					label="Used"
					value="{formatBytes(d.usedBytes)} ({formatPercent(pct(d.usedBytes, d.totalBytes))})"
					fraction={d.totalBytes > 0 ? d.usedBytes / d.totalBytes : 0}
					level={d.status.level}
				/>
				<Metric
					label="Free"
					value="{formatBytes(d.freeBytes)} ({formatPercent(pct(d.freeBytes, d.totalBytes))})"
				/>
			</ul>
		{:else}
			<p class="empty">Unavailable right now.</p>
		{/if}
	</section>

	<section aria-labelledby="h-photos">
		<h2 id="h-photos">Photos</h2>
		<p class="help">
			Proof photos stored on disk. <a href={resolve('/admin/images')}>Manage photos</a>
		</p>
		{#if !snap.photos}
			<p class="empty">Unavailable right now.</p>
		{:else if !snap.photos.exists || snap.photos.count === 0}
			<p class="empty">No photos yet.</p>
		{:else}
			{@const p = snap.photos}
			<ul class="rows">
				<Metric label="Files" value={count(p.count)} />
				<Metric label="Total size" value={formatBytes(p.totalBytes)} level={p.status.level} />
				<Metric label="Oldest" value={day(p.oldest)} />
				<Metric label="Newest" value={day(p.newest)} />
				{#if p.otherFiles > 0}
					<Metric label="Other files" value={count(p.otherFiles)} note="Not counted above." />
				{/if}
				{#if p.truncated}
					<Metric label="Note" value="Very large folder" note="Only the first files were counted." />
				{/if}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="h-db">
		<h2 id="h-db">Database</h2>
		{#if !snap.database}
			<p class="empty">Unavailable right now.</p>
		{:else if !dbOk}
			<ul class="rows">
				<Metric label="Connection" value="Database unreachable" level="critical" />
			</ul>
		{:else}
			<ul class="rows">
				<Metric label="Size" value={formatBytes(dbOk.sizeBytes)} />
				<Metric
					label="Connections"
					value="{dbOk.connections} of {dbOk.maxConnections}"
					fraction={dbOk.maxConnections > 0 ? dbOk.connections / dbOk.maxConnections : 0}
					level={dbOk.connectionsStatus?.level ?? 'ok'}
				/>
				<Metric
					label="Response time"
					value={formatMs(dbOk.responseMs)}
					level={dbOk.responseStatus?.level ?? 'ok'}
					note="Round trip of a trivial query, measured by the app."
				/>
			</ul>
			{#if dbOk.tables.length > 0}
				<h3>Largest tables</h3>
				<ul class="rows">
					{#each dbOk.tables as t (t.name)}
						<Metric
							label={t.name}
							value={formatBytes(t.totalBytes)}
							note="about {count(t.rowEstimate)} rows"
						/>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	<section aria-labelledby="h-app">
		<h2 id="h-app">App</h2>
		{#if snap.app}
			{@const a = snap.app}
			<ul class="rows">
				<Metric label="Version" value={a.version} />
				<Metric label="Node" value={a.nodeVersion} />
				<Metric label="Uptime" value={formatDuration(a.uptimeSeconds)} />
				<Metric label="Process memory (RSS)" value={formatBytes(a.rssBytes)} />
				<Metric
					label="JS heap"
					value="{formatBytes(a.heapUsedBytes)} of {formatBytes(a.heapTotalBytes)}"
					fraction={a.heapTotalBytes > 0 ? a.heapUsedBytes / a.heapTotalBytes : 0}
				/>
				{#if snap.container?.available}
					{@const c = snap.container}
					{#if c.limitBytes !== null}
						<Metric
							label="Container memory"
							value="{formatBytes(c.usedBytes)} of {formatBytes(c.limitBytes)} ({formatPercent(
								pct(c.usedBytes, c.limitBytes)
							)})"
							fraction={c.usedBytes / c.limitBytes}
							level={c.status.level}
						/>
					{:else}
						<Metric
							label="Container memory"
							value="{formatBytes(c.usedBytes)}, no limit"
							level={c.status.level}
						/>
					{/if}
				{:else}
					<Metric label="Container memory" value="Not available" />
				{/if}
				{#if snap.eventLoop}
					<Metric
						label="Event loop delay (p99, last minute)"
						value={snap.eventLoop.p99Ms === null ? 'Not measured yet' : formatMs(snap.eventLoop.p99Ms)}
						level={snap.eventLoop.status.level}
					/>
				{:else}
					<Metric label="Event loop delay" value="Unavailable" />
				{/if}
			</ul>
		{:else}
			<p class="empty">Unavailable right now.</p>
		{/if}
	</section>

	<section aria-labelledby="h-host">
		<h2 id="h-host">VPS host</h2>
		<p class="help">Inside the container these are the numbers of the whole host.</p>
		{#if snap.hostMemory || snap.load}
			<ul class="rows">
				{#if snap.hostMemory}
					{@const m = snap.hostMemory}
					<Metric
						label="Host memory available"
						value="{formatBytes(m.availableBytes)} of {formatBytes(m.totalBytes)}"
						fraction={m.totalBytes > 0 ? 1 - m.availableBytes / m.totalBytes : 0}
						level={m.status.level}
					/>
				{:else}
					<Metric label="Host memory available" value="Unavailable" />
				{/if}
				{#if snap.load}
					{@const l = snap.load}
					<Metric
						label="Host load (1, 5, 15 min)"
						value="{l.load1.toFixed(2)} / {l.load5.toFixed(2)} / {l.load15.toFixed(2)}"
						note="{l.cpus} {l.cpus === 1 ? 'CPU' : 'CPUs'}"
						fraction={l.load5 / (l.cpus * 3)}
						level={l.status.level}
					/>
				{:else}
					<Metric label="Host load" value="Unavailable" />
				{/if}
			</ul>
		{:else}
			<p class="empty">Unavailable right now.</p>
		{/if}
	</section>

	<section aria-labelledby="h-activity">
		<h2 id="h-activity">Activity and capacity</h2>
		{#if snap.activity}
			{@const a = snap.activity}
			<ul class="rows">
				<Metric label="Users (active / total)" value="{count(a.usersActive)} / {count(a.usersTotal)}" />
				<Metric label="Live sessions" value={count(a.liveSessions)} />
				<Metric label="Pending submissions" value={count(a.pendingSubmissions)} />
				<Metric label="Events, last 24 h" value={count(a.eventsLast24h)} />
				<Metric label="Submissions, last 24 h" value={count(a.submissionsLast24h)} />
				<Metric label="Posts" value={count(a.posts)} />
				<Metric label="Comments" value={count(a.comments)} />
			</ul>
		{:else}
			<p class="empty">Unavailable right now.</p>
		{/if}
	</section>

	<section aria-labelledby="h-notes" class="notes">
		<h2 id="h-notes">Notes</h2>
		<ul>
			<li>Backups run on the VPS (<code>deploy/backup.sh</code>); this page cannot see them.</li>
			<li>Photos of a finished period can be deleted from <a href={resolve('/admin/images')}>Images</a>.</li>
		</ul>
	</section>
</div>

<style>
	section {
		margin-top: var(--sp-6);
	}
	section h2 {
		margin-bottom: var(--sp-2);
	}
	h3 {
		margin: var(--sp-4) 0 var(--sp-2);
		font-size: var(--fs-lead);
	}
	.help {
		margin: 0 0 var(--sp-3);
		color: var(--muted);
		font-size: var(--fs-ui);
	}
	.overall {
		margin-top: 0;
	}
	.verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
		margin: 0;
		font-size: var(--fs-lead);
	}
	.chip.big {
		min-height: 32px;
		padding: 0 var(--sp-3);
		font-size: var(--fs-body);
	}
	.reasons {
		margin: var(--sp-3) 0 0;
		padding: 0 0 0 var(--sp-5);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-2) var(--sp-4);
		margin-top: var(--sp-4);
	}
	.auto {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		min-height: 44px;
	}
	.updated {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-small);
	}
	.notes ul {
		margin: 0;
		padding-left: var(--sp-5);
		color: var(--muted);
	}
	.notes li + li {
		margin-top: var(--sp-2);
	}
	.empty {
		padding: var(--sp-3) 0;
	}
	@media (min-width: 900px) {
		.admin-page {
			max-width: 860px;
		}
	}
</style>
