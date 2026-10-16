<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import PasswordMeter from '$lib/components/PasswordMeter.svelte';

	let { data, form } = $props();
	let password = $state('');
	let busy = $state(false);
</script>

<svelte:head>
	<title>Reset password</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<h2>Reset your password</h2>
{#if !data.token}
	<p class="error" role="alert">This reset link is invalid or expired. Ask an admin for a new one.</p>
	<p><a href={resolve('/login')}>Back to log in</a></p>
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
		<label>
			New password
			<input
				type="password"
				name="password"
				autocomplete="new-password"
				required
				bind:value={password}
			/>
		</label>
		<PasswordMeter {password} />
		<label>
			Confirm new password
			<input type="password" name="confirm" autocomplete="new-password" required />
		</label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<button type="submit" disabled={busy}>Set new password</button>
	</form>
{/if}
