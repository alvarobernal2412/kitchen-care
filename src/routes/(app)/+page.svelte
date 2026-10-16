<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Component } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { formatRemaining } from '$lib/duration';
	import ChoreTile, { type ChoreTask, type TileState } from '$lib/components/ChoreTile.svelte';
	import CreditHeader from '$lib/components/CreditHeader.svelte';
	import RecentActivity from '$lib/components/RecentActivity.svelte';

	let { data } = $props();

	// One shared 1 s tick for every countdown and relative time on the page.
	let now = $state(Date.now());
	const timer = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(timer));

	// Absolute availability time (ms) per task key. Server values are anchored to the moment
	// the data arrived; 409 responses and fresh logs override them. Remaining time derives from `now`.
	let overrides = $state<Record<string, number>>({});
	const serverAvailableAt = $derived.by(() => {
		const loadedAt = Date.now();
		const out: Record<string, number> = {};
		// 0 for free chores: anchoring them to `loadedAt` would read as "cooling down" until the next tick
		for (const t of data.tiles) out[t.key] = t.retryAfterSeconds > 0 ? loadedAt + t.retryAfterSeconds * 1000 : 0;
		return out;
	});
	const availableAt = (key: string) => overrides[key] ?? serverAvailableAt[key] ?? 0;

	const MAX_PENDING = 3; // mirrors MAX_PENDING_PER_TASK on the server

	const tiles = $derived(
		data.tiles.map((t) => {
			const task: ChoreTask = {
				key: t.key,
				label: t.label,
				points: t.points,
				needsPhoto: t.needsPhoto,
				needsReview: t.needsReview
			};
			const at = availableAt(t.key);
			let state: TileState;
			if (!data.period) state = 'unavailable';
			else if (at > now) state = 'cooldown';
			else if (t.needsReview && t.pendingCount > 0) state = 'pending';
			else if (t.needsReview) state = 'photo';
			else state = 'ready';
			return { task, state, at, cooldownSeconds: t.cooldownSeconds, full: t.pendingCount >= MAX_PENDING, pending: t.pendingCount };
		})
	);

	const READY_NAMES: Record<string, string> = {
		cutlery: 'cutlery',
		dishwasher: 'dishwasher',
		grounds: 'coffee grounds'
	};
	const readyNames = $derived(
		tiles
			.filter((t) => t.state === 'ready')
			.map((t) => READY_NAMES[t.task.key] ?? t.task.label.toLowerCase())
	);

	// What is on screen for the credit total; differs from data.total only during the count-up.
	// svelte-ignore state_referenced_locally
	let shown = $state(data.total);
	let animating = false;
	$effect(() => {
		const t = data.total;
		if (!animating) shown = t;
	});

	let busyKey = $state<string | null>(null);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let announce = $state('');
	let notes = $state<Record<string, string>>({});
	let noteTimers: ReturnType<typeof setTimeout>[] = [];
	onDestroy(() => noteTimers.forEach(clearTimeout));

	let tileRefs: Record<string, ChoreTile | undefined> = {};
	let totalEl: HTMLElement | undefined = $state();

	// ---- the one motion moment: stamp, +N flies to the total, total counts up ----
	type Fly = { id: number; n: number; left: number; top: number; dx: number; dy: number };
	let fly = $state<Fly | null>(null);
	let rafId = 0;

	const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const onScreen = (r: DOMRect) =>
		r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
	const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

	// Each celebration gets a number; only the latest one may touch shared state, so a second log
	// that starts mid-animation is never cut off by the first one finishing.
	let celebrationId = 0;

	function tween(from: number, to: number, ms: number, current: () => boolean): Promise<void> {
		return new Promise((resolve) => {
			const start = performance.now();
			const step = (t: number) => {
				if (!current()) return resolve(); // superseded: the newer celebration owns the number
				const p = Math.min(1, (t - start) / ms);
				const eased = 1 - Math.pow(1 - p, 3);
				shown = p >= 1 ? to : Math.round(from + (to - from) * eased);
				if (p >= 1) resolve();
				else rafId = requestAnimationFrame(step);
			};
			rafId = requestAnimationFrame(step);
		});
	}

	async function celebrate(key: string, points: number, newTotal: number | undefined) {
		const id = ++celebrationId;
		const current = () => id === celebrationId;
		const target = newTotal ?? shown + points;
		const tile = tileRefs[key];
		const from = tile?.stamp() ?? null; // under reduced motion the global CSS shortens the stamp to ~0
		announce = `${points} credit${points === 1 ? '' : 's'} logged. Total ${target}.`;
		const task = data.tiles.find((t) => t.key === key);
		overrides[key] = Date.now() + (task?.cooldownSeconds ?? 0) * 1000;

		animating = true;
		try {
			if (reducedMotion()) {
				shown = target;
			} else {
				const to = totalEl?.getBoundingClientRect();
				let flies = false;
				if (from && to && onScreen(from) && onScreen(to)) {
					fly = { id, n: points, left: from.left, top: from.top, dx: to.left - from.left, dy: to.top - from.top };
					flies = true;
				}
				if (flies) await wait(480);
				if (current()) await tween(shown, target, 600, current);
			}
		} finally {
			if (current()) {
				fly = null;
				shown = target;
				animating = false;
			}
		}
		if (!current()) return;
		await invalidateAll(); // rank, summary and recent activity
		if (current()) overrides = {};
	}

	function note(key: string, text: string) {
		notes[key] = text;
		noteTimers.push(
			setTimeout(() => {
				delete notes[key];
			}, 4000)
		);
	}

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
		let credited: { points: number; newTotal: number | undefined } | null = null;
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
				if (key === 'cutlery') {
					credited = { points: body.pointsAwarded ?? 1, newTotal: body.newTotal };
				} else {
					note(key, 'Sent for review');
					announce = 'Sent for review. An admin will check your photo.';
					await invalidateAll();
				}
			} else {
				failure(key, res, body);
			}
		} catch {
			message = { kind: 'error', text: 'Network error. Please try again.' };
		} finally {
			busyKey = null;
		}
		if (credited) await celebrate(key, credited.points, credited.newTotal);
	}

	function failure(key: string, res: Response, body: { error?: string; retryAfterSeconds?: number }) {
		if (body.error === 'cooldown') {
			overrides[key] = Date.now() + (body.retryAfterSeconds ?? 0) * 1000;
			message = {
				kind: 'error',
				text: `Try again in ${formatRemaining(body.retryAfterSeconds ?? 0)}`
			};
		} else if (body.error === 'no_active_period') {
			message = { kind: 'error', text: 'No active period right now.' };
		} else if (body.error === 'too_many_pending') {
			message = {
				kind: 'error',
				text: 'You already have 3 of these waiting for review. Please wait for an admin.'
			};
		} else if (body.error === 'invalid_image' || body.error === 'too_large') {
			message = { kind: 'error', text: 'That photo could not be used. Please retake it.' };
		} else if (body.error === 'rate_limited' || res.status === 429) {
			message = { kind: 'error', text: 'Too many tries in a row. Wait a minute and try again.' };
		} else if (res.status === 401) {
			location.href = '/login';
		} else {
			message = { kind: 'error', text: 'Something went wrong. Please try again.' };
		}
	}

	async function log(key: string) {
		busyKey = key;
		message = null;
		let credited: { points: number; newTotal: number | undefined } | null = null;
		try {
			const res = await fetch(`/api/tasks/${key}`, { method: 'POST' });
			const body = await res.json().catch(() => ({}));
			if (res.ok) credited = { points: body.pointsAwarded, newTotal: body.newTotal };
			else failure(key, res, body);
		} catch {
			message = { kind: 'error', text: 'Network error. Please try again.' };
		} finally {
			busyKey = null;
		}
		if (credited) await celebrate(key, credited.points, credited.newTotal);
	}

	function onTile(task: ChoreTask) {
		if (task.needsPhoto || task.needsReview) void openCamera(task.key);
		else void log(task.key);
	}

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		return () => cancelAnimationFrame(rafId);
	});
</script>

<svelte:head><title>Kitchen Care Credits</title></svelte:head>

{#snippet submissions()}
	{#if data.recent.length > 0}
		<section class="mine" aria-labelledby="mine-h">
			<h2 id="mine-h">Your submissions</h2>
			<ul class="list">
				{#each data.recent as r (r.id)}
					<li>
						<span class="what">{r.label}</span>
						{#if r.status === 'approved'}
							<span class="st ok">Approved +{r.points}</span>
						{:else if r.status === 'pending'}
							<span class="st wait">Waiting for review</span>
						{:else}
							<span class="st bad">Rejected</span>
						{/if}
						{#if r.status === 'rejected' && r.rejectReason}
							<span class="reason">{r.rejectReason}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<h1 class="visually-hidden">Home</h1>

{#if !data.period || !data.standing}
	<section class="empty">
		<h2>No active period yet</h2>
		<p>No period is running. An admin starts the next one.</p>
	</section>
	<div class="solo">{@render submissions()}</div>
{:else}
	<CreditHeader
		periodName={data.period.name}
		total={data.total}
		{shown}
		standing={data.standing}
		ready={readyNames}
		bind:totalEl
	/>

	<div class="layout">
		<section aria-labelledby="log">
			<h2 class="sec" id="log">Log a chore</h2>
			<p
				class="msg"
				class:has={message !== null}
				class:err={message?.kind === 'error'}
				role="status"
				data-testid="message"
			>
				{message?.text ?? ''}
			</p>
			<p class="visually-hidden" role="status" data-testid="announce">{announce}</p>
			<div class="tiles" data-ready={mounted ? '' : undefined}>
				{#each tiles as t (t.task.key)}
					<ChoreTile
						bind:this={tileRefs[t.task.key]}
						task={t.task}
						state={t.state}
						availableAt={t.at}
						cooldownSeconds={t.cooldownSeconds}
						{now}
						wide={t.task.key === 'deep_clean'}
						busy={busyKey === t.task.key}
						disabled={(busyKey !== null && busyKey !== t.task.key) || (t.state === 'pending' && t.full)}
						note={notes[t.task.key] ?? null}
						pendingCount={t.pending}
						onLog={onTile}
					/>
				{/each}
			</div>
		</section>

		<div class="side">
			<section class="recent" aria-labelledby="rec">
				<h2 id="rec">Recent in the kitchen</h2>
				<RecentActivity items={data.activity} {now} />
			</section>
			{@render submissions()}
		</div>
	</div>
{/if}

{#if fly}
	{#key fly.id}
	<span
		class="fly"
		style:left="{fly.left}px"
		style:top="{fly.top}px"
		style:--dx="{fly.dx}px"
		style:--dy="{fly.dy}px"
		aria-hidden="true"
		data-testid="fly">+{fly.n}</span
	>
	{/key}
{/if}

{#if capture}
	{@const c = capture}
	<c.Camera
		detect={c.detect}
		onCancel={() => (capture = null)}
		onCapture={(blob, result) => submitPhoto(c.key, blob, result.detected)}
	/>
{/if}

<style>
	h2 {
		font-size: var(--fs-h2);
		line-height: 1.15;
	}
	.sec {
		margin: var(--sp-5) 0 var(--sp-3);
	}
	.layout {
		display: block;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--sp-3);
	}
	.msg {
		margin: 0;
		font-size: 14px;
		color: var(--ink);
	}
	.msg.has {
		margin-bottom: var(--sp-3);
		padding: var(--sp-3);
		border-radius: var(--r-ctl);
		background: var(--accent-wash);
		color: var(--accent-ink);
	}
	.msg.err {
		background: var(--danger-wash);
		color: var(--danger);
	}

	.side {
		padding-bottom: var(--sp-6);
	}
	.recent,
	.mine {
		margin-top: var(--sp-6);
	}
	.recent h2,
	.mine h2 {
		margin-bottom: var(--sp-3);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px var(--sp-3);
		padding: var(--sp-3) 0;
		border-top: 1px solid var(--line);
		font-size: 14px;
		line-height: 1.35;
	}
	.what {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.st {
		font-size: var(--fs-small);
		font-weight: 600;
	}
	.st.ok {
		color: var(--accent-ink);
	}
	.st.wait {
		color: var(--pending-ink);
	}
	.st.bad {
		color: var(--danger);
	}
	.reason {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: var(--fs-small);
	}

	.empty {
		margin-top: var(--sp-6);
		padding: var(--sp-6) var(--sp-4);
		border-radius: var(--r-tile);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.empty p {
		margin-top: var(--sp-2);
		color: var(--muted);
	}
	.solo {
		padding-bottom: var(--sp-6);
	}

	.fly {
		position: fixed;
		z-index: var(--z-tooltip);
		font: 800 40px / 1 var(--font-display);
		color: var(--accent-ink);
		pointer-events: none;
		animation: fly 620ms cubic-bezier(0.5, 0, 0.2, 1) forwards;
	}
	@keyframes fly {
		to {
			transform: translate(var(--dx), var(--dy)) scale(0.5);
			opacity: 0;
		}
	}

	@media (min-width: 900px) {
		.sec {
			margin-top: var(--sp-6);
		}
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 280px;
			gap: var(--sp-7);
			align-items: start;
		}
		.tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: var(--sp-4);
		}
	}
</style>
