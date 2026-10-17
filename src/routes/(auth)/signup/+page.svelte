<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount, untrack } from 'svelte';
	import PasswordMeter from '$lib/components/PasswordMeter.svelte';
	import Segmented from '$lib/components/Segmented.svelte';

	let { data, form } = $props();
	let password = $state('');
	let classification = $state(untrack(() => form?.classification ?? ''));
	let busy = $state(false);
	// Without JavaScript the department select is always shown (it is only needed for Employees);
	// with JavaScript it appears, and becomes required, once Employee is chosen.
	let js = $state(false);
	onMount(() => (js = true));
	const showDepartment = $derived(!js || classification === 'Employee');

	// The server answers with one message; attach it to the field it is about.
	type Field = 'username' | 'password' | 'classification' | 'department';
	const errorField = $derived.by((): Field | null => {
		const e = form?.error;
		if (!e) return null;
		if (/department/i.test(e)) return 'department';
		if (/Student or Employee/.test(e)) return 'classification';
		if (/password|policy/i.test(e)) return 'password';
		if (/username/i.test(e)) return 'username';
		return null;
	});
	const invalid = (f: Field) => (errorField === f ? 'true' : undefined);
	const err = (f: Field) => (errorField === f ? 'signup-error' : undefined);
</script>

<svelte:head><title>Sign up</title></svelte:head>

<h1>Create an account</h1>
<p class="slogan">Good karma pays out: Rack up your credits for this semester's grand reward.</p>
{#if data.welcomeBonus.open}
	<p class="offer" data-testid="welcome-offer">
		Sign up before {data.welcomeBonus.untilLabel} and start with {data.welcomeBonus.points} credits.
	</p>
{/if}

<form
	method="POST"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	}}
>
	<div class="field">
		<label class="label" for="username">Username</label>
		<input
			id="username"
			class="input"
			type="text"
			name="username"
			autocomplete="username"
			autocapitalize="none"
			spellcheck="false"
			required
			minlength="3"
			maxlength="32"
			value={form?.username ?? ''}
			aria-invalid={invalid('username')}
			aria-describedby={err('username')}
		/>
		{#if errorField === 'username'}<p id="signup-error" class="error" role="alert">{form?.error}</p>{/if}
	</div>

	<div class="field">
		<label class="label" for="password">Password</label>
		<input
			id="password"
			class="input"
			type="password"
			name="password"
			autocomplete="new-password"
			required
			bind:value={password}
			aria-invalid={invalid('password')}
			aria-describedby={[err('password'), 'pw-meter'].filter(Boolean).join(' ')}
		/>
		{#if errorField === 'password'}<p id="signup-error" class="error" role="alert">{form?.error}</p>{/if}
		<PasswordMeter {password} id="pw-meter" />
	</div>

	<div class="field">
		<span class="label" aria-hidden="true">I am a</span>
		<Segmented
			name="classification"
			ariaLabel="I am a"
			describedby={err('classification')}
			required
			value={classification}
			options={[
				{ value: 'Student', label: 'Student' },
				{ value: 'Employee', label: 'Employee' }
			]}
			onchange={(v) => (classification = v)}
		/>
		{#if errorField === 'classification'}<p id="signup-error" class="error" role="alert">{form?.error}</p>{/if}
	</div>

	{#if showDepartment}
		<div class="field">
			<label class="label" for="department">Department</label>
			<select
				id="department"
				class="select"
				name="department"
				required={js && classification === 'Employee'}
				aria-invalid={invalid('department')}
				aria-describedby={err('department')}
			>
				<option value="">{js ? 'Choose…' : 'Choose (Employees only)'}</option>
				{#each data.departments as d (d)}
					<option value={d} selected={form?.department === d}>{d}</option>
				{/each}
			</select>
			{#if errorField === 'department'}<p id="signup-error" class="error" role="alert">{form?.error}</p>{/if}
		</div>
	{/if}

	{#if form?.error && !errorField}<p id="signup-error" class="error" role="alert">{form.error}</p>{/if}
	<button type="submit" class="btn btn-primary btn-block submit" disabled={busy} aria-busy={busy}>
		{busy ? 'Signing up…' : 'Sign up'}
	</button>
</form>

<p class="alt">Already have an account? <a href={resolve('/login')}>Log in</a></p>

<style>
	.offer {
		margin-top: var(--sp-2);
		color: var(--accent-ink);
		font-weight: 600;
	}
</style>
