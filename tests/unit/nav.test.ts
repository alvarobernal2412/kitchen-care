import { describe, expect, it } from 'vitest';
import {
	ADMIN_NAV_ITEMS,
	NAV_ITEMS,
	isActive,
	parseNavCookie,
	safeReturnPath
} from '../../src/lib/nav';
import { POST } from '../../src/routes/preferences/nav/+server';

const item = (id: string) => [...NAV_ITEMS, ...ADMIN_NAV_ITEMS].find((i) => i.id === id)!;

describe('nav items', () => {
	it('lists the sidebar and bottom bar items', () => {
		expect(NAV_ITEMS.map((i) => i.id)).toEqual(['home', 'feed', 'leaderboard', 'history', 'profile']);
		expect(NAV_ITEMS.filter((i) => i.bottomBar).map((i) => i.id)).toEqual([
			'home',
			'feed',
			'leaderboard',
			'profile'
		]);
		expect(ADMIN_NAV_ITEMS.map((i) => i.label)).toEqual([
			'Periods',
			'Review',
			'Users',
			'Moderation',
			'Images',
			'Analytics'
		]);
	});
});

describe('isActive', () => {
	it('matches Home only on the root', () => {
		expect(isActive(item('home'), '/')).toBe(true);
		expect(isActive(item('home'), '/feed')).toBe(false);
	});
	it('is segment aware', () => {
		expect(isActive(item('feed'), '/feed')).toBe(true);
		expect(isActive(item('feed'), '/feed/123')).toBe(true);
		expect(isActive(item('feed'), '/feeds')).toBe(false);
	});
	it('matches the other sections', () => {
		expect(isActive(item('leaderboard'), '/leaderboard')).toBe(true);
		expect(isActive(item('history'), '/history')).toBe(true);
		expect(isActive(item('profile'), '/profile')).toBe(true);
		expect(isActive(item('profile'), '/profiles')).toBe(false);
	});
	it('matches admin sections', () => {
		expect(isActive(item('admin-review'), '/admin/review')).toBe(true);
		expect(isActive(item('admin-users'), '/admin/users/42')).toBe(true);
		expect(isActive(item('admin-users'), '/admin/usersx')).toBe(false);
		expect(isActive(item('admin-users'), '/admin/review')).toBe(false);
	});
});

describe('parseNavCookie', () => {
	it('defaults to expanded for anything unknown', () => {
		expect(parseNavCookie(undefined)).toBe('expanded');
		expect(parseNavCookie('')).toBe('expanded');
		expect(parseNavCookie('garbage')).toBe('expanded');
		expect(parseNavCookie('COLLAPSED')).toBe('expanded');
	});
	it('reads the two valid values', () => {
		expect(parseNavCookie('collapsed')).toBe('collapsed');
		expect(parseNavCookie('expanded')).toBe('expanded');
	});
});

describe('safeReturnPath', () => {
	const origin = 'https://kitchen.example';
	it('keeps a same-origin path and drops the query', () => {
		expect(safeReturnPath('https://kitchen.example/feed/1?x=1#h', origin)).toBe('/feed/1');
	});
	it('falls back to / for anything else', () => {
		expect(safeReturnPath(null, origin)).toBe('/');
		expect(safeReturnPath('https://evil.example/feed', origin)).toBe('/');
		expect(safeReturnPath('//evil.com', origin)).toBe('/');
		expect(safeReturnPath('javascript:alert(1)', origin)).toBe('/');
		expect(safeReturnPath('https://kitchen.example//evil.com', origin)).toBe('/');
		expect(safeReturnPath('not a url', origin)).toBe('/');
	});
});

type CookieSet = { name: string; value: string; opts: Record<string, unknown> };
async function call(
	body: Record<string, string>,
	opts: { referer?: string; accept?: string } = {}
) {
	const sets: CookieSet[] = [];
	const headers: Record<string, string> = {};
	if (opts.referer) headers.referer = opts.referer;
	if (opts.accept) headers.accept = opts.accept;
	const request = new Request('https://kitchen.example/preferences/nav', {
		method: 'POST',
		headers,
		body: new URLSearchParams(body)
	});
	const event = {
		request,
		url: new URL(request.url),
		cookies: {
			set: (name: string, value: string, o: Record<string, unknown>) =>
				sets.push({ name, value, opts: o })
		}
	};
	try {
		const res = await POST(event as never);
		return { res, sets };
	} catch (e) {
		return { thrown: e as { status: number; location?: string }, sets };
	}
}

describe('POST /preferences/nav', () => {
	it('sets the cookie and redirects 303 to the referer path', async () => {
		const { thrown, sets } = await call(
			{ state: 'collapsed' },
			{ referer: 'https://kitchen.example/feed?x=1' }
		);
		expect(thrown?.status).toBe(303);
		expect(thrown?.location).toBe('/feed');
		expect(sets).toHaveLength(1);
		expect(sets[0].name).toBe('kc_nav');
		expect(sets[0].value).toBe('collapsed');
		expect(sets[0].opts).toMatchObject({
			path: '/',
			sameSite: 'lax',
			httpOnly: false,
			maxAge: 60 * 60 * 24 * 365
		});
	});
	it('accepts expanded', async () => {
		const { sets } = await call({ state: 'expanded' });
		expect(sets[0].value).toBe('expanded');
	});
	it('rejects an invalid state with 400 and no cookie', async () => {
		const { thrown, sets } = await call({ state: 'sideways' });
		expect(thrown?.status).toBe(400);
		expect(sets).toHaveLength(0);
	});
	it('rejects a missing state', async () => {
		const { thrown } = await call({});
		expect(thrown?.status).toBe(400);
	});
	it.each(['https://evil.example/x', '//evil.com', 'javascript:alert(1)'])(
		'sends a hostile referer %s to /',
		async (referer) => {
			const { thrown } = await call({ state: 'collapsed' }, { referer });
			expect(thrown?.location).toBe('/');
		}
	);
	it('returns 204 for a JSON client', async () => {
		const { res, sets } = await call({ state: 'collapsed' }, { accept: 'application/json' });
		expect(res?.status).toBe(204);
		expect(sets).toHaveLength(1);
	});
});
