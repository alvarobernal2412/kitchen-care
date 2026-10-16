<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { formatRemaining } from '$lib/duration';
	import type { Component } from 'svelte';

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
		for (const t of [...data.selfReported, ...data.photoTasks]) out[t.key] = loadedAt + t.retryAfterSeconds * 1000;
		return out;
	});
	let busyKey = $state<string | null>(null);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	const waitFor = (key: string) =>
		Math.max(0, Math.ceil(((overrides[key] ?? serverAvailableAt[key] ?? 0) - now) / 1000));

	type Detect = (source: ImageBitmap | HTMLCanvasElement) => Promise<boolean>;
	type Capture = {
		key: string;
		Camera: Component<{
			onCapture: (blob: Blob, result: { detected: boolean | null }) => void;
			onCancel: () => void;
			detect?: Detect;
		}>;
		detect?: Detect;
	};
	let capture = $state.raw<Capture | null>(null);

	// The camera component and the (large) cutlery model are loaded only when a photo task is tapped.
	async function openCamera(key: string) {
		busyKey = key;
		message = null;
		try {
			const [{ default: Camera }, detect] = await Promise.all([
				import('$lib/components/CameraCapture.svelte'),
				key === 'cutlery'
					? import('$lib/client/cutlery').then((m) => m.detectCutlery as Detect)
					: Promise.resolve(undefined)
			]);
			capture = { key, Camera: Camera as Capture['Camera'], detect };
		} catch {
			message = { kind: 'error', text: 'Could not load the camera. Please try again.' };
		} finally {
			busyKey = null;
		}
	}

	async function submitPhoto(key: string, blob: Blob, detected: boolean | null) {
		capture = null;
		if (key === 'cutlery') {
			if (detected === false) {
				message = { kind: 'error', text: 'No cutlery detected, retake' };
				return;
			}
			if (detected === null) {
				message = { kind: 'error', text: "Couldn't run the cutlery check, please try again" };
				return;
			}
		}
		busyKey = key;
		message = null;
		try {
			let res: Response;
			if (key === 'cutlery') {
				res = await fetch('/api/submissions', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ taskKey: key, detected: true })
				});
			} else {
				const form = new FormData();
				form.set('taskKey', key);
				form.set('image', blob, blob.type === 'image/jpeg' ? 'photo.jpg' : 'photo.webp');
				res = await fetch('/api/submissions', { method: 'POST', body: form });
			}
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				message = {
					kind: 'ok',
					text: key === 'cutlery' ? '+1 credit' : 'Submitted — waiting for admin review'
				};
				overrides = {};
				await invalidateAll();
			} else if (body.error === 'cooldown') {
				overrides[key] = Date.now() + body.retryAfterSeconds * 1000;
				message = { kind: 'error', text: `Try again in ${formatRemaining(body.retryAfterSeconds)}` };
			} else if (body.error === 'no_active_period') {
				message = { kind: 'error', text: 'No active period right now.' };
			} else if (body.error === 'too_many_pending') {
				message = {
					kind: 'error',
					text: 'You already have 3 of these waiting for review. Please wait for an admin.'
				};
			} else if (body.error === 'invalid_image' || body.error === 'too_large') {
				message = { kind: 'error', text: 'That photo could not be used. Please retake it.' };
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
		{@const wait = waitFor(task.key)}
		<li>
			<button
				type="button"
				disabled={!data.period || wait > 0 || busyKey !== null}
				onclick={() => openCamera(task.key)}
			>
				{task.label} (+{task.points})
			</button>
			{#if wait > 0}
				<small>Try again in {formatRemaining(wait)}</small>
			{:else if task.key !== 'cutlery'}
				<small>Photo, reviewed by an admin</small>
			{/if}
		</li>
	{/each}
</ul>

{#if capture}
	{@const c = capture}
	<c.Camera
		detect={c.detect}
		onCancel={() => (capture = null)}
		onCapture={(blob, result) => submitPhoto(c.key, blob, result.detected)}
	/>
{/if}

<h3>My recent submissions</h3>
{#if data.recent.length === 0}
	<p class="muted">Nothing yet.</p>
{:else}
	<ul class="recent">
		{#each data.recent as r (r.id)}
			<li>
				{r.label}:
				<strong class={r.status}>{r.status}</strong>
				{#if r.status === 'approved'}(+{r.points}){/if}
				{#if r.status === 'rejected' && r.rejectReason}<small>{r.rejectReason}</small>{/if}
			</li>
		{/each}
	</ul>
{/if}

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
	.recent li {
		margin-bottom: 0.5rem;
	}
	.pending {
		color: #92400e;
	}
	.approved {
		color: #166534;
	}
	.rejected {
		color: #991b1b;
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
