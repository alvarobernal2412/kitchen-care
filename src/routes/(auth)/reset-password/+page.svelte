<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import PasswordMeter from '$lib/components/PasswordMeter.svelte';

	let { data, form } = $props();
	let password = $state('');
	let busy = $state(false);

	// "Passwords do not match" is about the confirm field; the rest concerns the new password
	// (or the link itself, which has no single field).
	const mismatch = $derived(form?.error === 'Passwords do not match');
	const linkError = $derived(!!form?.error && /link/i.test(form.error));
	const pwError = $derived(!!form?.error && !mismatch && !linkError);
</script>

<svelte:head>
	<title>Reset password</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<h1>Reset your password</h1>
{#if !data.token}
	<p class="error bad" role="alert">
		This reset link is invalid or expired. Ask an admin for a new one.
	</p>
	<p class="alt"><a href={resolve('/login')}>Back to log in</a></p>
{:else}
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
		<input type="hidden" name="token" value={data.token} />
		<div class="field">
			<label class="label" for="password">New password</label>
			<input
				id="password"
				class="input"
				type="password"
				name="password"
				autocomplete="new-password"
				required
				bind:value={password}
				aria-invalid={pwError ? 'true' : undefined}
				aria-describedby={[pwError ? 'reset-error' : '', 'pw-meter'].filter(Boolean).join(' ')}
			/>
			{#if pwError}<p id="reset-error" class="error" role="alert">{form?.error}</p>{/if}
			<PasswordMeter {password} id="pw-meter" />
		</div>
		<div class="field">
			<label class="label" for="confirm">Confirm new password</label>
			<input
				id="confirm"
				class="input"
				type="password"
				name="confirm"
				autocomplete="new-password"
				required
				aria-invalid={mismatch ? 'true' : undefined}
				aria-describedby={mismatch ? 'reset-error' : undefined}
			/>
			{#if mismatch}<p id="reset-error" class="error" role="alert">{form?.error}</p>{/if}
		</div>
		{#if linkError}<p id="reset-error" class="error" role="alert">{form?.error}</p>{/if}
		<button type="submit" class="btn btn-primary btn-block submit" disabled={busy} aria-busy={busy}>
			{busy ? 'Saving…' : 'Set new password'}
		</button>
	</form>
{/if}

<style>
	.bad {
		margin-top: var(--sp-4);
		font-size: var(--fs-body);
		line-height: 1.5;
	}
</style>
