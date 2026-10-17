<script lang="ts" module>
	export type ChoreTask = {
		key: string;
		label: string;
		points: number;
		needsPhoto: boolean;
		needsReview: boolean;
	};
	export type TileState = 'ready' | 'cooldown' | 'photo' | 'pending' | 'unavailable';

	/** "Ready in 45 s", "Ready in 58 min", "Ready in 2 h 14 min" (visible, second precision under a minute). */
	export function readyInText(seconds: number): string {
		if (seconds < 60) return `Ready in ${Math.max(1, Math.ceil(seconds))} s`;
		const totalMin = Math.ceil(seconds / 60);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		if (h === 0) return `Ready in ${m} min`;
		return m === 0 ? `Ready in ${h} h` : `Ready in ${h} h ${m} min`;
	}

	/** Spoken version, minute precision so the accessible name changes once a minute, not every second. */
	export function readyInSpoken(seconds: number): string {
		if (seconds < 60) return 'ready in less than a minute';
		const totalMin = Math.ceil(seconds / 60);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
		if (h === 0) return `ready in ${plural(m, 'minute')}`;
		return m === 0
			? `ready in ${plural(h, 'hour')}`
			: `ready in ${plural(h, 'hour')} ${plural(m, 'minute')}`;
	}

	/** Share (0..1) of the cooldown that has already elapsed. */
	export function elapsedShare(remainingMs: number, cooldownSeconds: number): number {
		if (cooldownSeconds <= 0) return 1;
		return Math.min(1, Math.max(0, 1 - remainingMs / (cooldownSeconds * 1000)));
	}
</script>

<script lang="ts">
	import { IconCamera, IconClock, IconHourglass } from '$lib/icons';

	let {
		task,
		state: tileState,
		availableAt = 0,
		cooldownSeconds = 0,
		now,
		wide = false,
		busy = false,
		disabled = false,
		note = null,
		pendingCount = 0,
		onLog
	}: {
		task: ChoreTask;
		state: TileState;
		/** Absolute time (ms epoch) the chore can be logged again. */
		availableAt?: number;
		/** Full cooldown length, to turn the remaining time into a fill. */
		cooldownSeconds?: number;
		/** Shared 1 s tick (ms epoch), passed down so tiles do not run their own timers. */
		now: number;
		wide?: boolean;
		busy?: boolean;
		/** Not tappable right now (another chore is in flight, or the pending cap is reached). */
		disabled?: boolean;
		/** Calm inline confirmation that replaces the state line, e.g. "Sent for review". */
		note?: string | null;
		/** The user's own submissions of this chore waiting for review. */
		pendingCount?: number;
		onLog: (task: ChoreTask) => void;
	} = $props();

	let button: HTMLButtonElement | undefined = $state();
	let stamping = $state(false);

	/** Plays the stamp and returns the box of the +N so the page can fly it to the total. */
	export function stamp(): DOMRect | null {
		stamping = false;
		// restart the animation if it is still running
		void button?.offsetWidth;
		stamping = true;
		return button?.querySelector('.num-pts')?.getBoundingClientRect() ?? null;
	}

	const remainingSec = $derived(Math.max(0, Math.ceil((availableAt - now) / 1000)));
	const fill = $derived(
		tileState === 'cooldown' ? Math.round(elapsedShare(availableAt - now, cooldownSeconds) * 1000) / 10 : 0
	);
	const inert = $derived(tileState === 'cooldown' || tileState === 'unavailable' || disabled);
	const showCamera = $derived(tileState === 'photo');

	const name = $derived.by(() => {
		const plus = `plus ${task.points} credit${task.points === 1 ? '' : 's'}`;
		if (tileState === 'cooldown') return `${task.label}, ${plus}, ${readyInSpoken(remainingSec)}`;
		if (tileState === 'pending')
			return `${task.label}, ${plus}, ${pendingCount} waiting for review${disabled ? '' : ', tap to submit another'}`;
		if (tileState === 'photo') return `${task.label}, ${plus}, photo and review, tap to take a photo`;
		if (task.needsPhoto) return `${task.label}, ${plus}, photo check, tap to log`;
		return `${task.label}, ${plus}, tap to log`;
	});

	function press() {
		if (inert || busy) return;
		onLog(task);
	}
</script>

<button
	bind:this={button}
	type="button"
	class="chore"
	class:ready={tileState === 'ready'}
	class:cool={tileState === 'cooldown'}
	class:photo={tileState === 'photo'}
	class:pend={tileState === 'pending'}
	class:wide
	class:stamping
	data-task={task.key}
	data-state={tileState}
	aria-label={name}
	aria-disabled={inert || busy ? 'true' : undefined}
	aria-busy={busy ? 'true' : undefined}
	style:--fill={tileState === 'cooldown' ? `${fill}%` : undefined}
	onclick={press}
	onanimationend={() => (stamping = false)}
>
	<span class="pts">
		<span class="num-pts">+{task.points}</span>
		{#if showCamera}<IconCamera size={22} />{/if}
	</span>
	<span class="text">
		<span class="label">{task.label}</span>
		<span class="state">
			{#if note}
				{note}
			{:else if tileState === 'cooldown'}
				<IconHourglass size={16} />{readyInText(remainingSec)}
			{:else if tileState === 'pending'}
				<IconClock size={16} />Waiting for review
			{:else if tileState === 'photo'}
				Photo + review
			{:else if task.needsPhoto}
				<IconCamera size={16} />Photo check
			{:else}
				Tap to log
			{/if}
		</span>
	</span>
</button>

<style>
	/* The tile is a button: set every box property explicitly instead of relying on browser defaults. */
	.chore {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: var(--sp-3);
		width: auto;
		min-width: 0;
		min-height: 152px;
		margin: 0 0 3px; /* room for the ready lip in every state: no shift when the state changes */
		padding: var(--sp-4);
		border: 0;
		border-radius: var(--r-tile);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-weight: 400;
		text-align: left;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px var(--line);
		transition:
			transform var(--dur-fast) var(--ease-press),
			box-shadow var(--dur-fast) var(--ease-out);
		-webkit-tap-highlight-color: transparent;
	}
	.chore > * {
		position: relative;
		z-index: 1;
	}
	.chore[aria-disabled='true'] {
		cursor: default;
	}

	.pts {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		font: 800 var(--fs-points) / 0.95 var(--font-display);
		letter-spacing: -0.03em;
	}
	.num-pts {
		display: inline-block;
	}
	.text {
		display: block;
		min-width: 0;
	}
	.label {
		display: block;
		font-size: var(--fs-ui);
		line-height: 1.25;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: var(--fs-small);
		line-height: 1.3;
	}

	/* ready: accent wash with a 3 px lip that collapses on press */
	.ready {
		background: var(--accent-wash);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent),
			0 3px 0 0 color-mix(in srgb, var(--accent) 50%, var(--ground));
	}
	.ready .pts,
	.ready .state {
		color: var(--accent-ink);
	}
	.ready .state {
		font-weight: 600;
	}
	.ready:not([aria-disabled='true']):hover {
		transform: translateY(-1px);
	}
	.ready:not([aria-disabled='true']):active {
		transform: translateY(2px);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent),
			0 1px 0 0 color-mix(in srgb, var(--accent) 50%, var(--ground));
	}

	/* cooldown: flat glaze fill rising from the bottom to the elapsed share */
	.cool::before {
		content: '';
		position: absolute;
		z-index: 0;
		inset: auto 0 0 0;
		height: var(--fill, 0%);
		background: var(--glaze);
	}
	.cool .pts {
		color: var(--muted);
	}

	.pend {
		background: var(--pending-wash);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pending) 45%, transparent);
	}
	.pend .pts,
	.pend .state {
		color: var(--pending-ink);
	}

	.wide {
		grid-column: 1 / -1;
		flex-direction: row;
		justify-content: flex-start;
		align-items: center;
		gap: var(--sp-5);
		min-height: 104px;
	}
	.wide .pts {
		justify-content: flex-start;
		align-items: center;
		gap: 10px;
		min-width: 112px;
		font-size: 60px;
	}

	/* the one motion moment: stamp (scale .97 to 1) with an accent ring that expands and fades */
	.stamping {
		animation: stamp 320ms var(--ease-press);
	}
	@keyframes stamp {
		0% {
			transform: scale(0.97);
			box-shadow:
				inset 0 0 0 1px var(--accent),
				0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent);
		}
		100% {
			transform: scale(1);
			box-shadow:
				inset 0 0 0 1px var(--accent),
				0 0 0 14px transparent;
		}
	}

	@media (min-width: 900px) {
		.chore {
			min-height: 168px;
			padding: 20px;
		}
		.wide {
			min-height: 104px;
		}
		.wide .pts {
			min-width: 150px;
		}
	}
</style>
