<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import PasswordMeter from '$lib/components/PasswordMeter.svelte';

	let { data, form } = $props();
	let password = $state('');
	let classification = $state(untrack(() => form?.classification ?? ''));
	let busy = $state(false);
</script>

<svelte:head><title>Sign up</title></svelte:head>

<h2>Create an account</h2>
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
	<label>
		Username
		<input
			type="text"
			name="username"
			autocomplete="username"
			required
			minlength="3"
			maxlength="32"
			value={form?.username ?? ''}
		/>
	</label>
	<label>
		Password
		<input
			type="password"
			name="password"
			autocomplete="new-password"
			required
			bind:value={password}
		/>
	</label>
	<PasswordMeter {password} />

	<fieldset>
		<legend>I am a</legend>
		<label class="inline">
			<input type="radio" name="classification" value="Student" required bind:group={classification} />
			Student
		</label>
		<label class="inline">
			<input type="radio" name="classification" value="Employee" bind:group={classification} />
			Employee
		</label>
	</fieldset>

	{#if classification === 'Employee'}
		<label>
			Department
			<select name="department" required>
				<option value="">Choose…</option>
				{#each data.departments as d (d)}
					<option value={d} selected={form?.department === d}>{d}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<button type="submit" disabled={busy}>Sign up</button>
</form>
<p>Already registered? <a href={resolve('/login')}>Log in</a></p>

<style>
	fieldset {
		margin: 1rem 0 0;
		padding: 0;
		border: 0;
	}
	legend {
		font-weight: 600;
	}
	.inline {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		margin: 0.25rem 1rem 0 0;
		font-weight: 400;
	}
</style>
