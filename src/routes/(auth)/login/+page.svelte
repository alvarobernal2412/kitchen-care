<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Log in</title></svelte:head>

<h2>Log in</h2>
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
		<input type="text" name="username" autocomplete="username" required value={form?.username ?? ''} />
	</label>
	<label>
		Password
		<input type="password" name="password" autocomplete="current-password" required />
	</label>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<button type="submit" disabled={busy}>Log in</button>
</form>
<p>New here? <a href={resolve('/signup')}>Create an account</a></p>
