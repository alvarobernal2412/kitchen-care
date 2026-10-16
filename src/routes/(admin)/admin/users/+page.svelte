<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	let copied = $state<number | null>(null);

	async function copy(userId: number, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = userId;
		} catch {
			copied = null; // the field stays selectable for a manual copy
		}
	}
</script>

<svelte:head><title>Users</title></svelte:head>

<h2>Users</h2>

<form method="GET" action={resolve('/admin/users')} class="search" role="search">
	<label class="sr" for="user-q">Search by username</label>
	<input id="user-q" type="text" name="q" value={data.q} maxlength="64" placeholder="Search username" />
	<button type="submit">Search</button>
</form>

{#if data.users.length === 0}
	<p class="muted">No users match.</p>
{/if}

<ul>
	{#each data.users as u (u.id)}
		<li class:inactive={!u.active}>
			<div class="head">
				<strong>{u.username}</strong>
				{#if u.role === 'admin'}<span class="tag admin">admin</span>{/if}
				{#if !u.active}<span class="tag off">deactivated</span>{/if}
				{#if u.id === data.meId}<span class="tag">you</span>{/if}
			</div>
			<div class="muted">
				{u.classification ?? 'No classification'}{u.department ? ` · ${u.department}` : ''}
				&middot; {u.points} pts this period &middot; joined {u.createdAt.slice(0, 10)}
			</div>

			{#if form?.userId === u.id}
				{#if form.error}<p class="error" role="alert">{form.error}</p>{/if}
				{#if form.done}<p class="ok" role="status">{form.done}</p>{/if}
				{#if form.resetUrl}
					<div class="reset" role="status">
						<label for="reset-{u.id}">Reset link for {u.username} (shown once)</label>
						<input id="reset-{u.id}" type="text" readonly value={form.resetUrl} onfocus={(e) => e.currentTarget.select()} />
						<button type="button" onclick={() => copy(u.id, form.resetUrl)}>
							{copied === u.id ? 'Copied' : 'Copy link'}
						</button>
						<p class="muted">
							Valid for 1 hour, single use. Share it only with the verified user. It will not be
							shown again.
						</p>
					</div>
				{/if}
			{/if}

			<div class="actions">
				<details>
					<summary>{u.role === 'admin' ? 'Remove admin' : 'Make admin'}</summary>
					<form method="POST" action="?/role" use:enhance>
						<input type="hidden" name="userId" value={u.id} />
						<input type="hidden" name="role" value={u.role === 'admin' ? 'user' : 'admin'} />
						<label class="confirm">
							<input type="checkbox" name="confirm" value="yes" required />
							{u.role === 'admin'
								? `Confirm: ${u.username} loses admin rights.`
								: `Confirm: ${u.username} becomes an admin.`}
						</label>
						<button type="submit" class:danger={u.role === 'admin'}>
							{u.role === 'admin' ? 'Remove admin' : 'Make admin'}
						</button>
					</form>
				</details>

				{#if u.active}
					<details>
						<summary>Deactivate</summary>
						<form method="POST" action="?/active" use:enhance>
							<input type="hidden" name="userId" value={u.id} />
							<input type="hidden" name="active" value="false" />
							<label class="confirm">
								<input type="checkbox" name="confirm" value="yes" required />
								Confirm: {u.username} is signed out everywhere and cannot sign in.
							</label>
							<button type="submit" class="danger">Deactivate</button>
						</form>
					</details>
				{:else}
					<form method="POST" action="?/active" use:enhance>
						<input type="hidden" name="userId" value={u.id} />
						<input type="hidden" name="active" value="true" />
						<button type="submit">Reactivate</button>
					</form>
				{/if}

				<form method="POST" action="?/reset" use:enhance>
					<input type="hidden" name="userId" value={u.id} />
					<button type="submit">Generate reset link</button>
				</form>
			</div>
		</li>
	{/each}
</ul>

<style>
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.search {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.muted {
		color: #6b7280;
		font-size: 0.9rem;
	}
	ul {
		padding: 0;
		list-style: none;
	}
	li {
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	li.inactive {
		opacity: 0.75;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.tag {
		padding: 0.05rem 0.5rem;
		font-size: 0.75rem;
		background: #e5e7eb;
		border-radius: 999px;
	}
	.tag.admin {
		color: white;
		background: #1d4ed8;
	}
	.tag.off {
		color: white;
		background: #6b7280;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: flex-start;
		margin-top: 0.6rem;
	}
	.actions form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	summary {
		cursor: pointer;
		padding: 0.5rem 0.75rem;
		color: #1d4ed8;
		border: 1px solid #1d4ed8;
		border-radius: 8px;
	}
	.confirm {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.reset {
		display: grid;
		gap: 0.4rem;
		padding: 0.6rem;
		margin-top: 0.5rem;
		background: #fef9c3;
		border-radius: 8px;
	}
	.ok {
		color: #166534;
	}
	.error {
		margin: 0.4rem 0 0;
		color: #991b1b;
	}
</style>
