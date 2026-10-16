<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import SidebarToggle from '$lib/components/SidebarToggle.svelte';
	import { IconSignOut } from '$lib/icons';
	import { avatarUrl } from '$lib/avatar';
	import { ADMIN_NAV_ITEMS, NAV_ITEMS, isActive, type NavItem, type NavState } from '$lib/nav';

	let {
		isAdmin = false,
		username,
		avatarPath = null,
		pendingCount = 0,
		nav,
		pathname,
		children
	}: {
		isAdmin?: boolean;
		username: string;
		avatarPath?: string | null;
		pendingCount?: number;
		nav: NavState;
		pathname: string;
		children: Snippet;
	} = $props();

	// Follows the server value, but the toggle may override it at once (optimistic).
	let navState = $derived(nav);

	const bottomItems = NAV_ITEMS.filter((i) => i.bottomBar);
	const onAdminPage = $derived(isAdmin && (pathname === '/admin' || pathname.startsWith('/admin/')));
	const badgeFor = (item: NavItem) => (item.id === 'admin-review' ? pendingCount : 0);
</script>

{#snippet badge(item: NavItem)}
	{#if badgeFor(item) > 0}<span class="badge num">{badgeFor(item)}</span>{/if}
{/snippet}

<a class="skip-link" href="#main">Skip to content</a>

<div class="shell" data-nav={navState}>
	<aside class="sidebar" id="sidebar">
		<a class="brand" href={resolve('/')} aria-label="Kitchen Care Credits">
			<span class="brand-mark" aria-hidden="true">KC</span>
			<span class="brand-text display" aria-hidden="true">Kitchen<br />Care Credits</span>
		</a>

		<SidebarToggle state={navState} onflip={(next) => (navState = next)} />

		<div class="scroller">
		<nav aria-label="Main" class="grow">
			<ul>
				{#each NAV_ITEMS as item (item.id)}
					{@const active = isActive(item, pathname)}
					<li>
						<a
							class="item"
							class:active
							style:anchor-name="--nav-{item.id}"
							href={resolve(item.href as '/')}
							aria-current={active ? 'page' : undefined}
						>
							<item.icon size={22} />
							<span class="label">{item.label}</span>
							<span class="tip" style:position-anchor="--nav-{item.id}" aria-hidden="true">{item.label}</span>
						</a>
					</li>
				{/each}
			</ul>
			{#if isAdmin}
				<hr class="divider" />
				<p class="group-label" id="admin-group">Admin</p>
				<ul aria-labelledby="admin-group">
					{#each ADMIN_NAV_ITEMS as item (item.id)}
						{@const active = isActive(item, pathname)}
						<li>
							<a
								class="item"
								class:active
								style:anchor-name="--nav-{item.id}"
								href={resolve(item.href as '/')}
								aria-current={active ? 'page' : undefined}
							>
								<item.icon size={22} />
								<span class="label">{item.label}</span>
								{@render badge(item)}
								<span class="tip" style:position-anchor="--nav-{item.id}" aria-hidden="true">{item.label}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</nav>

		<div class="foot">
			<hr class="divider" />
			<div class="who">
				<Avatar name={username} src={avatarUrl(avatarPath)} size={32} />
				<span class="who-name label">{username}</span>
			</div>
			<form method="POST" action="/logout">
				<button type="submit" class="item signout" style:anchor-name="--nav-signout">
					<IconSignOut size={22} />
					<span class="label">Sign out</span>
					<span class="tip" style:position-anchor="--nav-signout" aria-hidden="true">Sign out</span>
				</button>
			</form>
		</div>
		</div>
	</aside>

	<div class="content">
		{#if onAdminPage}
			<nav class="sections" aria-label="Admin sections">
				{#each ADMIN_NAV_ITEMS as item (item.id)}
					{@const active = isActive(item, pathname)}
					<a
						class="section"
						class:active
						href={resolve(item.href as '/')}
						aria-current={active ? 'page' : undefined}
					>
						{item.label}
						{@render badge(item)}
					</a>
				{/each}
			</nav>
		{/if}
		<main id="main" tabindex="-1">
			{@render children()}
		</main>
	</div>

	<nav class="tabbar" aria-label="Main">
		{#each bottomItems as item (item.id)}
			{@const active = isActive(item, pathname)}
			<a class="tab" class:active href={resolve(item.href as '/')} aria-current={active ? 'page' : undefined}>
				<item.icon size={24} />
				<span>{item.label}</span>
			</a>
		{/each}
	</nav>
</div>

<style>
	/* ---------- phone first: bottom tab bar ---------- */
	.skip-link {
		position: fixed;
		top: var(--sp-2);
		left: var(--sp-2);
		z-index: var(--z-skip);
		padding: var(--sp-3) var(--sp-4);
		background: var(--surface);
		color: var(--accent-ink);
		font-weight: 600;
		border: 2px solid var(--accent);
		border-radius: var(--r-ctl);
		transform: translateY(-200%);
	}
	.skip-link:focus {
		transform: none;
	}

	.shell {
		min-height: 100dvh;
	}
	.sidebar {
		display: none; /* not in the accessibility tree on phones */
	}

	.content {
		min-height: 100dvh;
		/* nothing hides behind the fixed bar */
		padding-bottom: calc(var(--bar-h) + env(safe-area-inset-bottom, 0px));
	}
	main {
		max-width: 960px;
		margin-inline: auto;
		padding-inline: var(--gutter);
	}
	main:focus {
		outline: none;
	}

	.tabbar {
		position: fixed;
		inset: auto 0 0 0;
		z-index: var(--z-bar);
		display: flex;
		height: calc(var(--bar-h) + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		background: var(--surface);
		border-top: 1px solid var(--line);
		box-shadow: var(--shadow-bar);
	}
	.tab {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-width: 0;
		color: var(--muted);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.2;
		text-decoration: none;
	}
	.tab.active {
		color: var(--accent-ink);
		font-weight: 600;
	}
	.tab.active::before {
		content: '';
		position: absolute;
		top: -1px;
		left: 50%;
		width: 56px;
		height: 3px;
		background: var(--accent);
		border-radius: 0 0 3px 3px;
		transform: translateX(-50%);
	}

	.sections {
		display: flex;
		gap: var(--sp-1);
		padding: var(--sp-2) var(--gutter);
		overflow-x: auto;
		scroll-snap-type: x proximity;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
		scrollbar-width: none;
	}
	.section {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		min-height: 44px;
		padding: 0 var(--sp-3);
		color: var(--muted);
		font-size: var(--fs-ui);
		font-weight: 500;
		text-decoration: none;
		border-radius: var(--r-ctl);
		scroll-snap-align: start;
	}
	.section.active {
		color: var(--accent-ink);
		background: var(--accent-wash);
		font-weight: 600;
	}

	.badge {
		display: inline-grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		background: var(--pending-wash);
		color: var(--pending-ink);
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
		border-radius: var(--r-chip);
	}

	/* ---------- laptop: sidebar ---------- */
	@media (min-width: 900px) {
		.tabbar,
		.sections {
			display: none;
		}
		.sidebar {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: var(--z-bar);
			display: flex;
			flex-direction: column;
			gap: var(--sp-2);
			width: var(--sidebar-w);
			padding: var(--sp-4) var(--sp-3) var(--sp-3);
			background: var(--surface);
			border-right: 1px solid var(--line);
			transition: width var(--dur-base) var(--ease-out);
		}
		/* Brand and toggle stay put; the nav and the footer (user, Sign out) scroll under them. */
		.scroller {
			display: flex;
			flex: 1;
			flex-direction: column;
			gap: var(--sp-2);
			min-height: 0;
		}
		.shell[data-nav='expanded'] .scroller {
			overflow-y: auto;
		}
		.content {
			padding-bottom: 0;
			padding-inline-start: var(--sidebar-w);
			transition: padding-inline-start var(--dur-base) var(--ease-out);
		}
		.shell[data-nav='collapsed'] .content {
			padding-inline-start: var(--rail-w);
		}
		.shell[data-nav='collapsed'] .sidebar {
			width: var(--rail-w);
		}
		main {
			padding-inline: var(--sp-6);
		}

		.grow {
			flex: 1;
		}
		ul {
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.divider {
			margin: var(--sp-2) var(--sp-1);
		}
		.group-label {
			margin: 0 0 var(--sp-1);
			padding: 0 var(--sp-3);
			color: var(--muted);
			font-size: var(--fs-small);
			font-weight: 600;
			letter-spacing: 0.04em;
			text-transform: uppercase;
		}

		.brand {
			display: flex;
			align-items: center;
			gap: var(--sp-3);
			min-height: 44px;
			padding: 0 var(--sp-3);
			color: var(--ink);
			text-decoration: none;
		}
		.brand-mark {
			display: none;
			width: 44px;
			height: 44px;
			place-items: center;
			background: var(--accent);
			color: var(--on-accent);
			font-family: var(--font-display);
			font-weight: 800;
			border-radius: var(--r-av);
		}
		.brand-text {
			font-size: 20px;
			font-weight: 800;
			line-height: 1.05;
		}
		.shell[data-nav='collapsed'] .brand {
			justify-content: center;
			padding: 0;
		}
		.shell[data-nav='collapsed'] .brand-mark {
			display: grid;
		}
		.shell[data-nav='collapsed'] .brand-text {
			display: none;
		}

		.item {
			position: relative;
			display: flex;
			align-items: center;
			gap: var(--sp-3);
			width: 100%;
			min-height: 44px;
			padding: 0 var(--sp-3);
			background: transparent;
			border: 0;
			border-radius: var(--r-ctl);
			color: var(--muted);
			font-size: var(--fs-ui);
			font-weight: 500;
			text-align: start;
			text-decoration: none;
			cursor: pointer;
			transition:
				background-color var(--dur-fast) var(--ease-out),
				color var(--dur-fast) var(--ease-out);
		}
		.item:hover {
			background: var(--recess);
			color: var(--ink);
		}
		.item.active {
			background: var(--accent-wash);
			color: var(--accent-ink);
			font-weight: 600;
		}
		.item .badge {
			margin-inline-start: auto;
		}

		.foot {
			display: flex;
			flex-direction: column;
			gap: var(--sp-1);
		}
		.foot .divider {
			margin-block: 0 var(--sp-2);
		}
		.who {
			display: flex;
			align-items: center;
			gap: var(--sp-3);
			min-height: 44px;
			padding: 0 var(--sp-3);
			color: var(--ink);
			font-size: var(--fs-ui);
			font-weight: 600;
		}
		.who-name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* tooltips exist only in the rail */
		.tip {
			display: none;
		}

		/* rail: labels stay in the DOM, visually hidden */
		.shell[data-nav='collapsed'] .label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.shell[data-nav='collapsed'] .item,
		.shell[data-nav='collapsed'] .who {
			justify-content: center;
			padding: 0;
		}
		.shell[data-nav='collapsed'] .item .badge {
			position: absolute;
			top: 2px;
			right: 0;
			min-width: 16px;
			height: 16px;
			padding: 0 4px;
			font-size: 11px;
		}
		.shell[data-nav='collapsed'] .group-label {
			display: none;
		}
		.shell[data-nav='collapsed'] .tip {
			position: absolute;
			top: 50%;
			left: calc(100% + var(--sp-2));
			z-index: var(--z-tooltip);
			display: block;
			padding: var(--sp-2) var(--sp-3);
			background: var(--ink);
			color: var(--surface);
			font-size: var(--fs-small);
			font-weight: 500;
			white-space: nowrap;
			border-radius: var(--r-chip);
			pointer-events: none;
			visibility: hidden;
			opacity: 0;
			transform: translateY(-50%);
			transition:
				opacity var(--dur-fast) var(--ease-out),
				visibility var(--dur-fast);
		}
		.shell[data-nav='collapsed'] .item:hover .tip,
		.shell[data-nav='collapsed'] .item:focus-visible .tip {
			visibility: visible;
			opacity: 1;
		}
	}

	/*
	 * Short laptop screens: the full rail (with the Admin group) is taller than the window, so it
	 * scrolls too. A scrolling box clips absolutely positioned children, so the tooltips switch to
	 * fixed positioning tied to their item by CSS anchor positioning (no JS). Where anchors are
	 * unsupported the tooltip is clipped on these screens; labels stay in the DOM regardless.
	 */
	@media (min-width: 900px) and (max-height: 800px) {
		.shell[data-nav='collapsed'] .scroller {
			overflow-y: auto;
			overflow-x: hidden;
			scrollbar-width: thin;
		}
		@supports (anchor-name: --x) {
			.shell[data-nav='collapsed'] .scroller {
				overflow-x: visible;
			}
			.shell[data-nav='collapsed'] .tip {
				position: fixed;
				top: anchor(center);
				left: anchor(right);
				margin-inline-start: var(--sp-2);
			}
		}
	}
</style>
