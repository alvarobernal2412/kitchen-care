<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { form } = $props();
	// Only set by the enhanced submit, so the server-rendered button is always enabled.
	let busy = $state(false);

	// The only message that is about the username field; everything else concerns the credentials.
	const userError = $derived(form?.error === 'Enter your username');
</script>

<svelte:head><title>Log in</title></svelte:head>

<h1>Log in</h1>
<p class="slogan">Good karma pays out: Rack up your credits for this semester's grand reward.</p>

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
			value={form?.username ?? ''}
			aria-invalid={userError ? 'true' : undefined}
			aria-describedby={userError ? 'login-error' : undefined}
		/>
		{#if userError}<p id="login-error" class="error" role="alert">{form?.error}</p>{/if}
	</div>
	<div class="field">
		<label class="label" for="password">Password</label>
		<input
			id="password"
			class="input"
			type="password"
			name="password"
			autocomplete="current-password"
			required
			aria-invalid={form?.error && !userError ? 'true' : undefined}
			aria-describedby={form?.error && !userError ? 'login-error' : undefined}
		/>
		{#if form?.error && !userError}<p id="login-error" class="error" role="alert">{form.error}</p>{/if}
	</div>
	<button type="submit" class="btn btn-primary btn-block submit" disabled={busy} aria-busy={busy}>
		{busy ? 'Logging in…' : 'Log in'}
	</button>
</form>

<p class="alt">New here? <a href={resolve('/signup')}>Create an account</a></p>
