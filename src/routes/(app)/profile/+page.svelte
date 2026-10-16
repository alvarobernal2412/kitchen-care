<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import PasswordMeter from '$lib/components/PasswordMeter.svelte';
	import { avatarUrl } from '$lib/avatar';
	import { prepareAvatar } from '$lib/client/avatar';

	let { data, form } = $props();

	const initials = $derived(data.profile.username.slice(0, 2).toUpperCase());
	const current = $derived(avatarUrl(data.profile.avatarPath));

	let newPassword = $state('');
	let pwBusy = $state(false);

	let blob = $state.raw<Blob | null>(null);
	let previewUrl = $state<string | null>(null);
	let avatarBusy = $state(false);
	let avatarMessage = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	function clearPreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		blob = null;
	}
	onDestroy(clearPreview);

	async function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		clearPreview();
		avatarMessage = null;
		try {
			blob = await prepareAvatar(file);
			previewUrl = URL.createObjectURL(blob);
		} catch {
			avatarMessage = { kind: 'error', text: 'Could not read that image. Try another photo.' };
		}
	}

	async function send(request: () => Promise<Response>, okText: string) {
		avatarBusy = true;
		avatarMessage = null;
		try {
			const res = await request();
			if (!res.ok) {
				avatarMessage = {
					kind: 'error',
					text:
						res.status === 429
							? 'Too many changes. Try again in a minute.'
							: res.status === 422
								? 'That file is not a usable image.'
								: 'Could not update your photo.'
				};
				return;
			}
			clearPreview();
			avatarMessage = { kind: 'ok', text: okText };
			await invalidateAll();
		} catch {
			avatarMessage = { kind: 'error', text: 'Network error. Please try again.' };
		} finally {
			avatarBusy = false;
		}
	}

	function save() {
		if (!blob) return;
		const body = new FormData();
		body.append('image', blob, 'avatar.webp');
		void send(() => fetch('/api/avatar', { method: 'POST', body }), 'Photo updated.');
	}

	function remove() {
		void send(() => fetch('/api/avatar', { method: 'DELETE' }), 'Photo removed.');
	}
</script>

<svelte:head><title>Profile</title></svelte:head>

<h2>Profile</h2>

<section class="who">
	{#if current}
		<img class="avatar" src={current} alt="Your avatar" data-testid="avatar" />
	{:else}
		<span class="avatar fallback" aria-hidden="true">{initials}</span>
	{/if}
	<dl>
		<dt>Username</dt>
		<dd>{data.profile.username}</dd>
		<dt>Classification</dt>
		<dd>{data.profile.classification ?? '-'}</dd>
		{#if data.profile.department}
			<dt>Department</dt>
			<dd>{data.profile.department}</dd>
		{/if}
	</dl>
</section>

<section>
	<h3>Profile photo</h3>
	<label class="file">
		Choose a photo
		<input type="file" accept="image/*" onchange={onPick} disabled={avatarBusy} />
	</label>
	{#if previewUrl}
		<img class="avatar preview" src={previewUrl} alt="Preview of your new avatar" data-testid="avatar-preview" />
		<div class="row">
			<button type="button" onclick={save} disabled={avatarBusy}>Save photo</button>
			<button type="button" class="secondary" onclick={clearPreview} disabled={avatarBusy}>Cancel</button>
		</div>
	{/if}
	{#if current && !previewUrl}
		<button type="button" class="secondary" onclick={remove} disabled={avatarBusy}>Remove photo</button>
	{/if}
	{#if avatarMessage}
		<p class={avatarMessage.kind === 'ok' ? 'ok' : 'error'} role="status">{avatarMessage.text}</p>
	{/if}
</section>

<section>
	<h3>Change password</h3>
	<form
		method="POST"
		action="?/password"
		use:enhance={() => {
			pwBusy = true;
			return async ({ update }) => {
				await update({ reset: true });
				newPassword = '';
				pwBusy = false;
			};
		}}
	>
		<label>
			Current password
			<input type="password" name="currentPassword" autocomplete="current-password" required />
		</label>
		<label>
			New password
			<input
				type="password"
				name="newPassword"
				autocomplete="new-password"
				required
				bind:value={newPassword}
			/>
		</label>
		<PasswordMeter password={newPassword} />
		<label>
			Confirm new password
			<input type="password" name="confirmPassword" autocomplete="new-password" required />
		</label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.passwordChanged}
			<p class="ok" role="status">Password changed. Your other devices were signed out.</p>
		{/if}
		<button type="submit" disabled={pwBusy}>Change password</button>
	</form>
</section>

<style>
	section {
		margin-bottom: 2rem;
	}
	h3 {
		margin: 0 0 0.5rem;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	dl {
		margin: 0;
	}
	dt {
		font-size: 0.75rem;
		color: #6b7280;
	}
	dd {
		margin: 0 0 0.4rem;
		font-weight: 600;
	}
	.avatar {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}
	.avatar.preview {
		display: block;
		margin: 0.75rem 0;
	}
	.fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.4rem;
		font-weight: 700;
		color: #1d4ed8;
		background: #dbeafe;
	}
	.file {
		display: block;
		font-weight: 600;
	}
	.file input {
		display: block;
		margin-top: 0.4rem;
		font-weight: 400;
	}
	.row {
		display: flex;
		gap: 0.75rem;
	}
	.secondary {
		margin-top: 0.75rem;
		color: #374151;
		background: transparent;
		border: 1px solid #d1d5db;
	}
	.row .secondary {
		margin-top: 0;
	}
	.ok {
		color: #047857;
	}
	.error {
		color: #b91c1c;
	}
</style>
