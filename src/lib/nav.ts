import type { Component } from 'svelte';
import {
	IconBoard,
	IconCalendar,
	IconChart,
	IconClock,
	IconFeed,
	IconFlag,
	IconHome,
	IconImages,
	IconInbox,
	IconUser,
	IconUsers
} from '$lib/icons';

export type NavState = 'expanded' | 'collapsed';
export const NAV_COOKIE = 'kc_nav';
export const NAV_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type NavItem = {
	id: string;
	href: string;
	label: string;
	icon: Component<{ size?: number; class?: string; title?: string }>;
	/** Shown in the phone bottom bar (the sidebar shows every item). */
	bottomBar: boolean;
	/** `exact` matches only that path; otherwise the path or any child segment. */
	match: 'exact' | 'prefix';
};

export const NAV_ITEMS: NavItem[] = [
	{ id: 'home', href: '/', label: 'Home', icon: IconHome, bottomBar: true, match: 'exact' },
	{ id: 'feed', href: '/feed', label: 'Feed', icon: IconFeed, bottomBar: true, match: 'prefix' },
	{
		id: 'leaderboard',
		href: '/leaderboard',
		label: 'Leaderboard',
		icon: IconBoard,
		bottomBar: true,
		match: 'prefix'
	},
	{
		id: 'history',
		href: '/history',
		label: 'History',
		icon: IconClock,
		bottomBar: false,
		match: 'prefix'
	},
	{
		id: 'profile',
		href: '/profile',
		label: 'Profile',
		icon: IconUser,
		bottomBar: true,
		match: 'prefix'
	}
];

const admin = (id: string, label: string, icon: NavItem['icon']): NavItem => ({
	id: `admin-${id}`,
	href: `/admin/${id}`,
	label,
	icon,
	bottomBar: false,
	match: 'prefix'
});

export const ADMIN_NAV_ITEMS: NavItem[] = [
	admin('periods', 'Periods', IconCalendar),
	admin('review', 'Review', IconInbox),
	admin('users', 'Users', IconUsers),
	admin('moderation', 'Moderation', IconFlag),
	admin('images', 'Images', IconImages),
	admin('analytics', 'Analytics', IconChart)
];

/** Segment aware: `/feed/123` is Feed, `/feeds` is not. */
export function isActive(item: Pick<NavItem, 'href' | 'match'>, pathname: string): boolean {
	if (item.match === 'exact') return pathname === item.href;
	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function parseNavCookie(value: string | undefined): NavState {
	return value === 'collapsed' ? 'collapsed' : 'expanded';
}

/** Same-origin path of `referer` without query or hash; `/` for anything untrusted. */
export function safeReturnPath(referer: string | null | undefined, origin: string): string {
	if (!referer) return '/';
	try {
		const url = new URL(referer);
		if (url.origin !== origin) return '/';
		if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return '/';
		return url.pathname;
	} catch {
		return '/';
	}
}
