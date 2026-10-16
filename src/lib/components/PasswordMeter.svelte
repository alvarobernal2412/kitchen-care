<script lang="ts">
	import { RULE_LABELS, validatePassword, type PasswordRule } from '$lib/passwordRules';

	/**
	 * Strength is said in words ("Weak", "Almost there", "Strong") and by how many of the four
	 * segments are filled; colour only reinforces it. The rules still missing are listed in plain
	 * words, so the list doubles as the password policy before anything is typed.
	 */
	let { password, id }: { password: string; id?: string } = $props();

	const SEGMENTS = 4;
	const rules = Object.keys(RULE_LABELS) as PasswordRule[];
	const result = $derived(validatePassword(password));
	const score = $derived(rules.length - result.missing.length);
	const filled = $derived(password === '' ? 0 : Math.round((score / rules.length) * SEGMENTS));
	const label = $derived(score <= 2 ? 'Weak' : score < rules.length ? 'Almost there' : 'Strong');
</script>

<div class="meter" {id} data-testid="password-meter">
	<div class="bar" data-filled={filled} data-level={filled >= 3 ? 'good' : 'low'} aria-hidden="true">
		{#each Array.from({ length: SEGMENTS }, (_, i) => i) as i (i)}
			<i class:on={i < filled}></i>
		{/each}
	</div>
	<p class="strength" aria-live="polite">
		{#if password !== ''}Password strength: <strong>{label}</strong>{/if}
	</p>
	{#if result.missing.length}
		<p class="need">Still needed:</p>
		<ul>
			{#each result.missing as rule (rule)}
				<li>{RULE_LABELS[rule]}</li>
			{/each}
		</ul>
	{:else}
		<p class="need">All rules met</p>
	{/if}
</div>

<style>
	.meter {
		display: grid;
		gap: 6px;
		font-size: var(--fs-small);
		line-height: 1.4;
		color: var(--muted);
	}
	.bar {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.bar i {
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.bar[data-level='low'] i.on {
		background: var(--pending);
	}
	.bar[data-level='good'] i.on {
		background: var(--accent);
	}
	.strength {
		min-height: 1.4em;
		margin: 0;
		color: var(--ink);
	}
	.strength strong {
		font-weight: 600;
	}
	.need {
		margin: 0;
	}
	ul {
		margin: 0;
		padding-left: 1.2em;
	}
</style>
