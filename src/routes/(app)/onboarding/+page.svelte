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

<form method="POST" use:enhance={() => markDone()}>
	{#if js}<p class="progress" aria-live="polite">Step {step + 1} of {STEPS}</p>{/if}

	{#if show(0)}
		<section aria-labelledby="s1">
			<h2 id="s1">How credits work</h2>
			<p class="slogan">Good karma pays out: Rack up your credits for this semester's grand reward.</p>
			<table>
				<tbody>
					{#each data.tasks as t (t.key)}
						<tr><td>{t.label}</td><td class="pts">+{t.points}</td></tr>
					{/each}
				</tbody>
			</table>
			<p>Some tasks need a photo, and the bigger ones need an admin's approval before the credits count.</p>
		</section>
	{/if}

	{#if show(1)}
		<section aria-labelledby="s2">
			<h2 id="s2">Your karma</h2>
			<p>
				Credits are your karma. Everything you do for the kitchen adds up and shows on the
				leaderboard, so every small favor counts.
			</p>
		</section>
	{/if}

	{#if show(2)}
		<section aria-labelledby="s3">
			<h2 id="s3">Semester prize</h2>
			<p>
				When the period ends, the group chips in for a prize for the top contributor. If several
				people tie for first place, they share the win.
			</p>
		</section>
	{/if}

	<div class="actions">
		{#if js && step > 0}
			<button type="button" class="secondary" onclick={() => step--}>Back</button>
		{/if}
		{#if js && !last}
			<button type="button" onclick={() => step++}>Next</button>
		{:else}
			<button type="submit">Get started</button>
		{/if}
	</div>
	<button type="submit" class="skip">Skip</button>
</form>

<style>
	.progress {
		margin: 0 0 0.5rem;
		color: #6b7280;
		font-size: 0.85rem;
	}
	section {
		margin-bottom: 1.5rem;
	}
	h2 {
		margin: 0 0 0.5rem;
	}
	.slogan {
		font-weight: 600;
		color: #1d4ed8;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin: 0.75rem 0;
	}
	td {
		padding: 0.35rem 0;
		border-bottom: 1px solid #e5e7eb;
	}
	.pts {
		text-align: right;
		font-weight: 700;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
	}
	.secondary,
	.skip {
		color: #374151;
		background: transparent;
		border: 1px solid #d1d5db;
	}
	.skip {
		margin-top: 0.75rem;
		border: 0;
		font-weight: 400;
		text-decoration: underline;
	}
</style>
