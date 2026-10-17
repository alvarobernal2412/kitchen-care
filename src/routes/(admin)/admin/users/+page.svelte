<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarUrl } from '$lib/avatar';
	import Notice from '$lib/components/Notice.svelte';

	let { data, form } = $props();

	let copied = $state<number | null>(null);
	let copyFailed = $state<number | null>(null);
	// A new link starts without the previous "Copied" or failure message.
	$effect(() => {
		void form?.resetUrl;
		copied = null;
		copyFailed = null;
	});

	function selectAll(el: HTMLElement) {
		const range = document.createRange();
		range.selectNodeContents(el);
		const sel = getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	// The result is shown on the row, so the actions fold away once one has been sent.
	const closing: SubmitFunction = () => async ({ formElement, update }) => {
		formElement.closest('details')?.removeAttribute('open');
		await update();
	};

	async function copy(userId: number, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = userId;
			copyFailed = null;
		} catch {
			copied = null;
			copyFailed = userId; // the link stays selectable for a manual copy
		}
	}
</script>

<svelte:head><title>Users</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Users</h1>
		<p class="sub">Search people, change roles, and hand out one-time password reset links.</p>
	</header>

	<form method="GET" action={resolve('/admin/users')} class="search" role="search">
		<label class="label" for="user-q">Search by username</label>
		<div class="search-row">
			<input
				id="user-q"
				type="text"
				name="q"
				class="input"
				value={data.q}
				maxlength="64"
				autocomplete="off"
			/>
			<button type="submit" class="btn btn-quiet">Search</button>
		</div>
	</form>

	{#if data.users.length === 0}
		<p class="empty">No users match.</p>
	{:else}
		<ul class="rows" aria-label="Users">
			{#each data.users as u (u.id)}
				{@const mine = form?.userId === u.id}
				<li class="u" class:inactive={!u.active}>
					<div class="head">
						<Avatar name={u.username} src={avatarUrl(u.avatarPath)} seed={u.id} size={40} />
						<div class="id">
							<p class="name">
								<b>{u.username}</b>
								{#if u.role === 'admin'}<span class="chip">Admin</span>{/if}
								{#if !u.active}<span class="chip chip-danger">Deactivated</span>{/if}
								{#if u.id === data.meId}<span class="chip chip-neutral">You</span>{/if}
							</p>
							<p class="meta">
								{u.classification ?? 'No classification'}{u.department ? `, ${u.department}` : ''}
								&middot; joined {u.createdAt.slice(0, 10)}
							</p>
						</div>
						<p class="pts">
							<span class="display num">{u.points}</span>
							<span class="meta">pts this period</span>
						</p>
					</div>

					{#if mine && form?.error}
						<Notice kind="error" role="alert">{form.error}</Notice>
					{/if}
					{#if mine && form?.done}
						<Notice kind="ok" role="status">{form.done}</Notice>
					{/if}
					{#if mine && form?.resetUrl}
						<div class="reset" role="status">
							<p class="label">Reset link for {u.username} (shown once)</p>
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<code
								class="reset-url"
								tabindex="0"
								onfocus={(e) => selectAll(e.currentTarget)}
								>{form.resetUrl}</code
							>
							<div class="cluster">
								<button type="button" class="btn btn-primary" onclick={() => copy(u.id, form.resetUrl)}
									>Copy link</button
								>
								<span class="copied" aria-live="polite"
									>{copied === u.id
										? 'Copied'
										: copyFailed === u.id
											? "Couldn't copy. Select the link and copy it."
											: ''}</span
								>
							</div>
							<p class="help">
								Valid for 1 hour, single use. Share it only with the verified user. It will not be
								shown again.
							</p>
						</div>
					{/if}

					<details class="acts">
						<summary class="btn btn-quiet">Actions<span class="visually-hidden"> for {u.username}</span></summary>
						<div class="panel">
							<form method="POST" action="?/role" use:enhance={closing} class="act">
								<input type="hidden" name="userId" value={u.id} />
								<input type="hidden" name="role" value={u.role === 'admin' ? 'user' : 'admin'} />
								<label class="check">
									<input type="checkbox" name="confirm" value="yes" required />
									<span
										>{u.role === 'admin'
											? `Confirm: ${u.username} loses admin rights.`
											: `Confirm: ${u.username} becomes an admin.`}</span
									>
								</label>
								<button type="submit" class="btn btn-quiet" class:btn-danger={u.role === 'admin'}>
									{u.role === 'admin' ? 'Remove admin' : 'Make admin'}
								</button>
							</form>

							{#if u.active}
								<form method="POST" action="?/active" use:enhance={closing} class="act">
									<input type="hidden" name="userId" value={u.id} />
									<input type="hidden" name="active" value="false" />
									<label class="check">
										<input type="checkbox" name="confirm" value="yes" required />
										<span>Confirm: {u.username} is signed out everywhere and cannot sign in.</span>
									</label>
									<button type="submit" class="btn btn-danger">Deactivate</button>
								</form>
							{:else}
								<form method="POST" action="?/active" use:enhance={closing} class="act">
									<input type="hidden" name="userId" value={u.id} />
									<input type="hidden" name="active" value="true" />
									<button type="submit" class="btn btn-quiet">Reactivate</button>
								</form>
							{/if}

							<form method="POST" action="?/reset" use:enhance={closing} class="act">
								<input type="hidden" name="userId" value={u.id} />
								<button type="submit" class="btn btn-quiet">Generate reset link</button>
							</form>

							<div class="act">
								<a class="btn btn-quiet" href="{resolve('/admin/activity')}?user={encodeURIComponent(u.username)}"
									>View activity<span class="visually-hidden"> of {u.username}</span></a
								>
							</div>
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.search {
		margin-bottom: var(--sp-5);
	}
	.search-row {
		display: flex;
		gap: var(--sp-2);
		margin-top: 6px;
	}
	.search-row .input {
		flex: 1;
		min-width: 0;
	}
	@media (min-width: 900px) {
		.search {
			max-width: 440px;
		}
	}

	.u {
		display: grid;
		gap: var(--sp-3);
	}
	/* Deactivated: greyed avatar and a muted name; text is never faded (it must keep its contrast). */
	.u.inactive .head :global(.avatar) {
		filter: grayscale(1);
	}
	.u.inactive .name b {
		color: var(--muted);
	}
	.head {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr);
		align-items: center;
		gap: var(--sp-3);
	}
	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-1) var(--sp-2);
		max-width: none;
	}
	.name b {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.meta {
		color: var(--muted);
		font-size: var(--fs-small);
		line-height: 1.4;
	}
	.pts {
		grid-column: 2;
		display: flex;
		align-items: baseline;
		gap: var(--sp-2);
	}
	.pts .display {
		font-size: 22px;
		font-weight: 800;
		line-height: 1;
	}

	.reset {
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-4);
		border: 1px solid var(--accent);
		border-radius: var(--r-ctl);
		background: var(--accent-wash);
		color: var(--ink);
	}
	.reset .label {
		max-width: none;
	}
	.reset .help {
		color: var(--ink);
	}
	.reset-url {
		display: block;
		padding: var(--sp-3);
		border-radius: var(--r-chip);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.4;
		overflow-wrap: anywhere;
		word-break: break-all;
		user-select: all;
	}
	.copied {
		color: var(--accent-ink);
		font-weight: 600;
		font-size: var(--fs-ui);
	}

	.acts summary {
		display: inline-flex;
		list-style: none;
	}
	.acts summary::-webkit-details-marker {
		display: none;
	}
	.panel {
		display: grid;
		gap: var(--sp-4);
		margin-top: var(--sp-3);
		padding: var(--sp-3) 0 0;
		border-top: 1px solid var(--line);
	}
	.act {
		display: grid;
		gap: var(--sp-1);
		justify-items: start;
	}
	.act + .act {
		padding-top: var(--sp-3);
		border-top: 1px solid var(--line);
		width: 100%;
	}

	@media (min-width: 900px) {
		.u {
			padding: var(--sp-4) var(--sp-5);
		}
		.head {
			grid-template-columns: 40px minmax(0, 1fr) auto;
		}
		.pts {
			grid-column: 3;
			flex-direction: column;
			align-items: flex-end;
			gap: 2px;
		}
		.panel {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: var(--sp-5);
		}
		.act + .act {
			padding-top: 0;
			border-top: 0;
			width: auto;
		}
	}
</style>
