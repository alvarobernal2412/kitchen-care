<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { formatRemaining } from '$lib/duration';

	let { data } = $props();

	let now = $state(Date.now());
	const timer = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(timer));

	// Absolute availability time (ms) per task key. Server values are anchored to the moment
	// the data arrived; 409 responses override them. Remaining time is derived from `now`.
	let overrides = $state<Record<string, number>>({});
	const serverAvailableAt = $derived.by(() => {
		const loadedAt = Date.now();
		const out: Record<string, number> = {};
		for (const t of data.selfReported) out[t.key] = loadedAt + t.retryAfterSeconds * 1000;
		return out;
	});
	let busyKey = $state<string | null>(null);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	const waitFor = (key: string) =>
		Math.max(0, Math.ceil(((overrides[key] ?? serverAvailableAt[key] ?? 0) - now) / 1000));

	async function log(key: string) {
		busyKey = key;
		message = null;
		try {
			const res = await fetch(`/api/tasks/${key}`, { method: 'POST' });
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				message = { kind: 'ok', text: `+${body.pointsAwarded} points logged` };
				overrides = {};
				await invalidateAll();
			} else if (body.error === 'cooldown') {
				overrides[key] = Date.now() + body.retryAfterSeconds * 1000;
				message = { kind: 'error', text: `Try again in ${formatRemaining(body.retryAfterSeconds)}` };
			} else if (body.error === 'no_active_period') {
				message = { kind: 'error', text: 'No active period right now.' };
			} else if (res.status === 401) {
				location.href = '/login';
			} else {
				message = { kind: 'error', text: 'Something went wrong. Please try again.' };
			}
		} catch {
			message = { kind: 'error', text: 'Network error. Please try again.' };
		} finally {
			busyKey = null;
		}
	}
</script>

<svelte:head><title>Kitchen Care Credits</title></svelte:head>

{#if data.period}
	<h2>{data.period.name}</h2>
	<p class="total"><strong>{data.total}</strong> points this period</p>
{:else}
	<h2>No active period</h2>
	<p class="muted">Points can be logged once an admin starts a new period.</p>
{/if}

{#if message}
	<p class={message.kind === 'ok' ? 'ok' : 'error'} role="status">{message.text}</p>
{/if}

<h3>Log a task</h3>
<ul>
	{#each data.selfReported as task (task.key)}
		{@const wait = waitFor(task.key)}
		<li>
			<button
				type="button"
				disabled={!data.period || wait > 0 || busyKey !== null}
				onclick={() => log(task.key)}
			>
				{task.label} (+{task.points})
			</button>
			{#if wait > 0}<small>Try again in {formatRemaining(wait)}</small>{/if}
		</li>
	{/each}
	{#each data.photoTasks as task (task.key)}
		<li>
			<button type="button" disabled>{task.label} (+{task.points})</button>
			<small>Coming soon</small>
		</li>
	{/each}
</ul>

<style>
	ul {
		padding: 0;
		margin: 0;
		list-style: none;
	}
	li {
		margin-bottom: 0.75rem;
	}
	small,
	.muted {
		color: #6b7280;
	}
	small {
		display: block;
		margin-top: 0.25rem;
	}
	.total {
		font-size: 1.1rem;
	}
	.ok {
		margin: 1rem 0;
		padding: 0.6rem 0.8rem;
		color: #166534;
		background: #dcfce7;
		border-radius: 8px;
	}
	.error {
		margin: 1rem 0;
		padding: 0.6rem 0.8rem;
		color: #991b1b;
		background: #fee2e2;
		border-radius: 8px;
	}
</style>
