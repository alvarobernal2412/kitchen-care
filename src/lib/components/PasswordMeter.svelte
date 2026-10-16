<script lang="ts">
	import { RULE_LABELS, validatePassword, type PasswordRule } from '$lib/passwordRules';

	let { password }: { password: string } = $props();

	const rules = Object.keys(RULE_LABELS) as PasswordRule[];
	const result = $derived(validatePassword(password));
	const score = $derived(rules.length - result.missing.length);
	const label = $derived(
		password === '' ? '' : score <= 2 ? 'Weak' : score < rules.length ? 'Almost there' : 'Strong'
	);
</script>

<div class="meter" aria-live="polite">
	<div class="bar" role="presentation">
		<div
			class="fill"
			class:weak={score <= 2}
			class:mid={score > 2 && score < rules.length}
			class:strong={score === rules.length}
			style:width="{password === '' ? 0 : (score / rules.length) * 100}%"
		></div>
	</div>
	<p class="label">{label}</p>
	<ul>
		{#each rules as rule (rule)}
			{@const missing = result.missing.includes(rule)}
			<li class:ok={!missing}>
				<span aria-hidden="true">{missing ? '○' : '✓'}</span>
				{RULE_LABELS[rule]}
				<span class="sr">{missing ? '(missing)' : '(met)'}</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.bar {
		height: 6px;
		background: #e5e7eb;
		border-radius: 3px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		transition: width 0.2s;
	}
	.weak {
		background: #dc2626;
	}
	.mid {
		background: #d97706;
	}
	.strong {
		background: #16a34a;
	}
	.label {
		min-height: 1.2em;
		margin: 0.25rem 0;
		font-size: 0.85rem;
		color: #4b5563;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.85rem;
		color: #6b7280;
	}
	li.ok {
		color: #15803d;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
