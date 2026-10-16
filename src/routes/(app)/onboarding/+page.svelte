<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';

	let { data } = $props();

	const STEPS = 3;
	// Without JavaScript all three steps are shown stacked above a single "Get started" button.
	let js = $state(false);
	let step = $state(0);
	onMount(() => (js = true));

	const last = $derived(step === STEPS - 1);
	const show = (i: number) => !js || step === i;

	function markDone() {
		// Only a client-side hint: the server decides from the DB flag.
		try {
			localStorage.setItem('kc.onboarding_completed', '1');
		} catch {
			/* storage unavailable (private mode, blocked): nothing to do */
		}
	}
</script>

<svelte:head><title>Welcome</title></svelte:head>

<div class="page">
	<form method="POST" use:enhance={() => markDone()}>
		<h1 class="brand">Kitchen Care Credits</h1>

		{#if js}
			<div class="steps" data-testid="step-bar" aria-hidden="true">
				{#each Array.from({ length: STEPS }, (_, i) => i) as i (i)}
					<i data-on={i <= step ? '' : undefined}></i>
				{/each}
			</div>
			<p class="stepno" aria-live="polite">Step {step + 1} of {STEPS}</p>
		{/if}

		{#if show(0)}
			<section aria-labelledby="s1">
				<h2 id="s1">How credits work</h2>
				<p class="lead">Log a chore in up to three taps and earn credits. Bigger jobs pay more.</p>
				<ul class="pts-list">
					{#each data.tasks as t (t.key)}
						<li><span class="task">{t.label}</span><b class="pts">+{t.points}</b></li>
					{/each}
				</ul>
				<p class="note">
					Some chores need a photo and an admin's approval before the credits count. Each chore has
					a short cooldown, so credits stay fair for everyone.
				</p>
				<p class="slogan">
					<strong>Good karma pays out:</strong>
					<span>Rack up your credits for this semester's grand reward.</span>
				</p>
			</section>
		{/if}

		{#if show(1)}
			<section aria-labelledby="s2">
				<h2 id="s2">Your karma</h2>
				<p class="lead">
					Credits are your karma. Everything you do for the kitchen adds up and shows on the
					leaderboard, so every small favor counts.
				</p>
			</section>
		{/if}

		{#if show(2)}
			<section aria-labelledby="s3">
				<h2 id="s3">The semester prize</h2>
				<p class="lead">
					When the period ends, the group chips in for a prize for the top contributor. If several
					people tie for first place, they share the win.
				</p>
			</section>
		{/if}

		<div class="actions">
			{#if js && !last}
				<button type="button" class="btn btn-primary btn-block" onclick={() => step++}>Next</button>
			{:else}
				<button type="submit" class="btn btn-primary btn-block">Get started</button>
			{/if}
			<div class="more">
				{#if js && step > 0}
					<button type="button" class="plain" onclick={() => step--}>Back</button>
				{/if}
				<button type="submit" class="plain">Skip</button>
			</div>
		</div>
	</form>
</div>

<style>
	.page {
		max-width: 480px;
		margin: 0 auto;
		padding: var(--sp-5) 0 var(--sp-6);
	}
	.brand {
		margin-bottom: var(--sp-4);
		font-size: var(--fs-h2);
		line-height: 1.15;
		color: var(--accent-ink);
	}
	.steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.steps i {
		height: 4px;
		border-radius: 2px;
		background: var(--line);
	}
	.steps i[data-on] {
		background: var(--accent);
	}
	.stepno {
		margin-top: var(--sp-3);
		font-size: 14px;
		font-weight: 500;
		color: var(--muted);
	}
	section {
		margin-top: var(--sp-5);
	}
	section + section {
		margin-top: var(--sp-7);
		padding-top: var(--sp-6);
		border-top: 1px solid var(--line);
	}
	h2 {
		font-size: 36px;
		line-height: 1;
	}
	.lead {
		margin-top: var(--sp-3);
		font-size: var(--fs-lead);
		line-height: 1.45;
	}
	.pts-list {
		margin: var(--sp-5) 0 0;
		padding: 0;
		list-style: none;
		border-top: 2px solid var(--ink);
	}
	.pts-list li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-4);
		min-height: 52px;
		border-bottom: 1px solid var(--line);
	}
	.pts {
		font: 800 28px / 1 var(--font-display);
		letter-spacing: -0.03em;
		color: var(--accent-ink);
		font-variant-numeric: tabular-nums;
	}
	.note {
		margin-top: var(--sp-3);
		font-size: 14px;
		color: var(--muted);
	}
	.slogan {
		margin-top: var(--sp-6);
	}
	.slogan strong {
		display: block;
		font: 800 30px / 1.05 var(--font-display);
		letter-spacing: -0.02em;
		text-wrap: balance;
	}
	.slogan span {
		display: block;
		margin-top: 6px;
		color: var(--muted);
		text-wrap: balance;
	}
	.actions {
		display: grid;
		gap: var(--sp-2);
		margin-top: var(--sp-6);
	}
	.more {
		display: flex;
		justify-content: center;
		gap: var(--sp-5);
	}
	.plain {
		width: auto;
		min-height: 48px;
		padding: 0 var(--sp-4);
		border: 0;
		background: transparent;
		color: var(--muted);
		font-weight: 600;
		cursor: pointer;
	}
	.plain:hover {
		color: var(--ink);
	}
</style>
