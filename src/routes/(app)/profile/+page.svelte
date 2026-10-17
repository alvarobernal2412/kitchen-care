<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import PasswordMeter from '$lib/components/PasswordMeter.svelte';
	import { IconCaretRight } from '$lib/icons';
	import { avatarUrl } from '$lib/avatar';
	import { prepareAvatar } from '$lib/client/avatar';

	let { data, form } = $props();

	const current = $derived(avatarUrl(data.profile.avatarPath));

	let newPassword = $state('');
	let nameBusy = $state(false);
	// svelte-ignore state_referenced_locally
	let usernameDraft = $state(form?.username ?? data.profile.username);
	const nameErrorField = $derived(form?.usernameError ? form.usernameField : null);
	let pwBusy = $state(false);

	let blob = $state.raw<Blob | null>(null);
	let previewUrl = $state<string | null>(null);
	let avatarBusy = $state(false);
	let avatarMessage = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	// The server answers with one message; attach it to the field it is about.
	type Field = 'current' | 'new' | 'confirm';
	const errorField = $derived.by((): Field | null => {
		const e = form?.error;
		if (!e) return null;
		if (/current password/i.test(e)) return 'current';
		if (/do not match/i.test(e)) return 'confirm';
		if (/policy/i.test(e)) return 'new';
		return null;
	});
	const invalid = (f: Field) => (errorField === f ? 'true' : undefined);

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

<div class="page">
	<h1>Profile</h1>

	<section class="who" aria-label="Your details">
		<div class="face" data-testid={current ? 'avatar' : undefined}>
			<Avatar name={data.profile.username} src={current} size={96} />
		</div>
		<div class="id">
			<p class="name">{data.profile.username}</p>
			{#if data.profile.classification}<p class="meta">{data.profile.classification}</p>{/if}
			{#if data.profile.department}<p class="meta">{data.profile.department}</p>{/if}
		</div>
	</section>

	<section aria-labelledby="photo-h">
		<h2 id="photo-h">Photo</h2>
		<div class="stack">
			<label class="btn btn-quiet file" class:busy={avatarBusy}>
				Choose a photo
				<input
					class="visually-hidden"
					type="file"
					accept="image/*"
					onchange={onPick}
					disabled={avatarBusy}
				/>
			</label>
			{#if previewUrl}
				<img
					class="preview"
					src={previewUrl}
					alt="Preview of your new avatar"
					data-testid="avatar-preview"
				/>
				<div class="cluster">
					<button type="button" class="btn btn-primary" onclick={save} disabled={avatarBusy}>
						Save photo
					</button>
					<button type="button" class="btn btn-quiet" onclick={clearPreview} disabled={avatarBusy}>
						Cancel
					</button>
				</div>
			{/if}
			{#if current && !previewUrl}
				<button type="button" class="btn btn-quiet" onclick={remove} disabled={avatarBusy}>
					Remove photo
				</button>
			{/if}
			<p
				class="note"
				class:ok={avatarMessage?.kind === 'ok'}
				class:bad={avatarMessage?.kind === 'error'}
				role="status"
				aria-live="polite"
			>
				{avatarMessage?.text ?? ''}
			</p>
		</div>
	</section>

	<section aria-labelledby="username-h">
		<h2 id="username-h">Username</h2>
		<p class="note">Your username is {data.profile.username}.</p>
		<form
			method="POST"
			action="?/username"
			use:enhance={() => {
				nameBusy = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'redirect') usernameDraft = data.profile.username;
					const pw = document.getElementById('usernamePassword') as HTMLInputElement | null;
					if (pw) pw.value = '';
					nameBusy = false;
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
					bind:value={usernameDraft}
					aria-invalid={nameErrorField === 'username' ? 'true' : undefined}
					aria-describedby={nameErrorField === 'username' ? 'username-error' : undefined}
				/>
				{#if nameErrorField === 'username'}
					<p id="username-error" class="error" role="alert">{form?.usernameError}</p>
				{/if}
			</div>
			<div class="field">
				<label class="label" for="usernamePassword">Current password</label>
				<input
					id="usernamePassword"
					class="input"
					type="password"
					name="currentPassword"
					autocomplete="current-password"
					required
					aria-invalid={nameErrorField === 'password' ? 'true' : undefined}
					aria-describedby={nameErrorField === 'password' ? 'username-pw-error' : undefined}
				/>
				{#if nameErrorField === 'password'}
					<p id="username-pw-error" class="error" role="alert">{form?.usernameError}</p>
				{/if}
			</div>
			{#if form?.usernameError && !nameErrorField}
				<p class="error" role="alert">{form.usernameError}</p>
			{/if}
			{#if data.renamed && !form?.usernameError}
				<p class="note ok" role="status" aria-live="polite">
					Username changed to {data.profile.username}.
				</p>
			{/if}
			<button type="submit" class="btn btn-primary btn-block" disabled={nameBusy} aria-busy={nameBusy}>
				Change username
			</button>
		</form>
	</section>

	<section aria-labelledby="password-h">
		<h2 id="password-h">Password</h2>
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
			<div class="field">
				<label class="label" for="currentPassword">Current password</label>
				<input
					id="currentPassword"
					class="input"
					type="password"
					name="currentPassword"
					autocomplete="current-password"
					required
					aria-invalid={invalid('current')}
					aria-describedby={errorField === 'current' ? 'pw-error' : undefined}
				/>
				{#if errorField === 'current'}<p id="pw-error" class="error" role="alert">{form?.error}</p>{/if}
			</div>
			<div class="field">
				<label class="label" for="newPassword">New password</label>
				<input
					id="newPassword"
					class="input"
					type="password"
					name="newPassword"
					autocomplete="new-password"
					required
					bind:value={newPassword}
					aria-invalid={invalid('new')}
					aria-describedby={[errorField === 'new' ? 'pw-error' : '', 'pw-meter']
						.filter(Boolean)
						.join(' ')}
				/>
				{#if errorField === 'new'}<p id="pw-error" class="error" role="alert">{form?.error}</p>{/if}
				<PasswordMeter password={newPassword} id="pw-meter" />
			</div>
			<div class="field">
				<label class="label" for="confirmPassword">Confirm new password</label>
				<input
					id="confirmPassword"
					class="input"
					type="password"
					name="confirmPassword"
					autocomplete="new-password"
					required
					aria-invalid={invalid('confirm')}
					aria-describedby={errorField === 'confirm' ? 'pw-error' : undefined}
				/>
				{#if errorField === 'confirm'}<p id="pw-error" class="error" role="alert">{form?.error}</p>{/if}
			</div>
			{#if form?.error && !errorField}<p id="pw-error" class="error" role="alert">{form.error}</p>{/if}
			{#if form?.passwordChanged}
				<p class="note ok" role="status">Password changed. Other devices were signed out.</p>
			{/if}
			<button type="submit" class="btn btn-primary btn-block" disabled={pwBusy} aria-busy={pwBusy}>
				Change password
			</button>
		</form>
	</section>

	{#if data.user.role === 'admin'}
		<section class="admin">
			<a class="link-row" href={resolve('/admin/review')}>
				<span>Open admin</span>
				<IconCaretRight size={20} />
			</a>
		</section>
	{/if}

	<section>
		<form method="POST" action="/logout">
			<button type="submit" class="btn btn-quiet signout">Sign out</button>
		</form>
	</section>
</div>

<style>
	.page {
		padding: var(--sp-5) 0 var(--sp-6);
	}
	section {
		margin-top: var(--sp-6);
		padding-top: var(--sp-6);
		border-top: 1px solid var(--line);
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		margin-top: var(--sp-5);
		padding-top: 0;
		border-top: 0;
	}
	.face {
		flex: none;
		display: grid;
	}
	.id {
		min-width: 0;
	}
	.name {
		font: 800 28px / 1.1 var(--font-display);
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.meta {
		margin-top: 2px;
		color: var(--muted);
	}
	h2 {
		margin-bottom: var(--sp-4);
	}
	.file {
		position: relative;
		align-self: flex-start;
	}
	.file:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.file.busy {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.preview {
		display: block;
		width: 128px;
		height: 128px;
		border-radius: var(--r-av);
		object-fit: cover;
	}
	.cluster .btn,
	.stack > .btn {
		width: auto;
	}
	.note {
		margin: 0;
		font-size: var(--fs-ui);
		line-height: 1.4;
	}
	.note:empty {
		display: none;
	}
	.ok {
		color: var(--accent-ink);
	}
	.bad {
		color: var(--danger);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.admin {
		padding-top: 0;
	}
	.link-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 56px;
		color: var(--accent-ink);
		font-weight: 600;
		text-decoration: none;
	}
	.signout {
		width: 100%;
	}

	@media (min-width: 900px) {
		.page {
			max-width: 600px;
			padding-top: var(--sp-6);
		}
		.signout {
			width: auto;
		}
	}
</style>
