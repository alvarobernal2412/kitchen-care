import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SESSION_COOKIE } from '../../src/lib/server/auth/session';
import { ADMIN_PASSWORD, ADMIN_USERNAME, E2E_ORIGIN } from './env';
import { createUser, giveSession, overflowReport, uniqueUsername } from './helpers';
import { seedShowcase, type Showcase } from './showcase';

/*
 * Accessibility and layout matrix: every key page, light and dark, phone and laptop.
 *  - axe: zero serious or critical violations. Minor and moderate findings are printed at the end.
 *  - layout: no horizontal scroll and nothing past the viewport (checked on the same page visit).
 *  - The default run is a representative subset (every page at 390 light; the pages with a unique
 *    layout at 1280 dark; no-JS onboarding once). A11Y_FULL=1 (npm run test:a11y:full) runs both
 *    schemes at both viewports for every page, plus the layout check at 360 px.
 *  - keyboard, reduced motion and focus rings that scroll containers must not clip.
 * No axe rule is disabled.
 */

type Role = 'anon' | 'member' | 'admin' | 'fresh';
type Target = { name: string; path: string; role: Role };

const TARGETS: Target[] = [
	{ name: 'login', path: '/login', role: 'anon' },
	{ name: 'signup', path: '/signup', role: 'anon' },
	{ name: 'reset-password (invalid token)', path: '/reset-password?token=invalid', role: 'anon' },
	{ name: 'onboarding', path: '/onboarding', role: 'fresh' },
	{ name: 'home', path: '/', role: 'member' },
	{ name: 'leaderboard', path: '/leaderboard', role: 'member' },
	{ name: 'feed', path: '/feed', role: 'member' },
	{ name: 'history', path: '/history', role: 'member' },
	{ name: 'profile', path: '/profile', role: 'member' },
	{ name: '404', path: '/no-such-page', role: 'member' },
	{ name: 'offline page', path: '/offline/', role: 'anon' },
	{ name: 'admin review', path: '/admin/review', role: 'admin' },
	{ name: 'admin activity', path: '/admin/activity', role: 'admin' },
	{ name: 'admin users', path: '/admin/users', role: 'admin' },
	{ name: 'admin moderation', path: '/admin/moderation', role: 'admin' },
	{ name: 'admin images', path: '/admin/images', role: 'admin' },
	{ name: 'admin periods', path: '/admin/periods', role: 'admin' },
	{ name: 'admin analytics', path: '/admin/analytics', role: 'admin' },
	{ name: 'admin system', path: '/admin/system', role: 'admin' }
];

const SCHEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
	{ width: 390, height: 844 },
	{ width: 1280, height: 800 }
];
const FULL = process.env.A11Y_FULL === '1';
/** Pages whose layout differs from the others; these also get the laptop + dark cell by default. */
const UNIQUE_LAYOUT = new Set(['home', 'leaderboard', 'feed', 'admin review', 'admin analytics', 'profile', 'login']);

/** Whether a (scheme, viewport) cell of the matrix runs for a page in this run. */
function inMatrix(target: Target, scheme: string, width: number): boolean {
	if (FULL) return true;
	if (width === 390 && scheme === 'light') return true;
	return width === 1280 && scheme === 'dark' && UNIQUE_LAYOUT.has(target.name);
}

let showcase: Showcase;
let freshUser: { username: string; password: string };
const sessions = new Map<string, string>();
const findings: string[] = [];

test.beforeAll(async () => {
	showcase = await seedShowcase();
	freshUser = await createUser(uniqueUsername('a11y-fresh'), { onboarded: false });
});

test.afterAll(async () => {
	await showcase?.cleanup();
	if (findings.length) {
		console.log(`\naxe minor/moderate findings (not failing):\n${[...new Set(findings)].sort().join('\n')}`);
	}
});

/** Gives the context the session of a role (one login per role; the cookie is reused). */
async function signIn(context: BrowserContext, role: Role): Promise<void> {
	if (role === 'anon') return;
	const creds =
		role === 'admin'
			? { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
			: role === 'fresh'
				? freshUser
				: showcase.me;
	let id = sessions.get(role);
	if (!id) {
		id = await giveSession(context, creds.username, creds.password);
		sessions.set(role, id);
		return;
	}
	await context.addCookies([{ name: SESSION_COOKIE, value: id, url: E2E_ORIGIN }]);
}

async function open(page: Page, target: Target): Promise<void> {
	await signIn(page.context(), target.role);
	await page.goto(target.path);
	await expect(page.locator('main, body').first()).toBeVisible();
	await page.waitForLoadState('networkidle');
}

for (const scheme of SCHEMES) {
	for (const viewport of VIEWPORTS) {
		test.describe(`${scheme}, ${viewport.width}px`, () => {
			test.use({ colorScheme: scheme, viewport, reducedMotion: 'reduce' });

			for (const target of TARGETS.filter((t) => inMatrix(t, scheme, viewport.width))) {
				test(`${target.name}: no serious or critical axe violations, fits the viewport`, async ({ page }) => {
					await open(page, target);
					const label = `${target.name} ${scheme} ${viewport.width}`;
					expect(await overflowReport(page), `${label} overflow`).toEqual([]);
					await expectClean(page, label);
				});
			}

			// axe itself needs JavaScript in the page, so the no-JS view is the server-rendered HTML served
			// back to a page with its scripts removed: same markup, same CSS, nothing hydrates.
			const onboarding = TARGETS.find((t) => t.name === 'onboarding')!;
			if (FULL || (scheme === 'light' && viewport.width === 390)) {
				test('onboarding without JavaScript has no serious or critical violations', async ({ page }) => {
					await signIn(page.context(), onboarding.role);
					const html = (await (await page.request.get(onboarding.path)).text()).replace(/<script[\s\S]*?<\/script>/g, '');
					await page.route(`**${onboarding.path}`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
					await page.goto(onboarding.path);
					await page.waitForLoadState('networkidle');
					await expect(page.locator('.steps')).toHaveCount(0); // the JS-only step bar is absent
					await expectClean(page, `onboarding (no JS) ${scheme} ${viewport.width}`);
				});
			}
		});
	}
}

async function expectClean(page: Page, label: string): Promise<void> {
	const { violations } = await new AxeBuilder({ page }).analyze();
	const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	for (const v of violations.filter((v) => !blocking.includes(v))) {
		findings.push(`${v.impact} ${v.id} (${label}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
	}
	// Compare plain strings: a failing expect prints them instead of axe's whole result objects.
	const report = blocking.flatMap((v) =>
		v.nodes.map(
			(n) => `${v.impact} ${v.id}: ${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 3).join(' ')})`
		)
	);
	expect(report, label).toEqual([]);
}

// ---------------------------------------------------------------- layout

// 360 px is the narrowest phone; the default run covers 390 and 1280 inside the matrix above.
if (FULL) {
	test.describe('layout at 360px', () => {
		test.use({ reducedMotion: 'reduce', viewport: { width: 360, height: 844 } });
		for (const target of TARGETS) {
			test(`${target.name} fits the viewport`, async ({ page }) => {
				await open(page, target);
				expect(await overflowReport(page)).toEqual([]);
			});
		}
	});
}

// ---------------------------------------------------------------- keyboard

type Stop = { tag: string; text: string; skip: boolean; sidebar: boolean; main: boolean; id: string; visible: boolean };

/** Describes the focused element, and whether its focus indication is visible (outline >= 2px or a ring). */
function describeFocus(): Stop {
	const el = document.activeElement as HTMLElement;
	const cs = getComputedStyle(el);
	const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
	const ring = cs.boxShadow !== 'none';
	return {
		tag: el.tagName.toLowerCase(),
		text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
		skip: el.classList.contains('skip-link'),
		sidebar: !!el.closest('#sidebar'),
		main: !!el.closest('main'),
		id: el.id,
		visible: outline || ring
	};
}

test.describe('keyboard', () => {
	test.use({ viewport: VIEWPORTS[0] });

	test('on Home the first three Tab stops are the skip link, then focus-visible elements', async ({ page }) => {
		await open(page, TARGETS.find((t) => t.name === 'home')!);
		const stops: Stop[] = [];
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Tab');
			stops.push(await page.evaluate(describeFocus));
		}
		expect(stops[0].skip, JSON.stringify(stops[0])).toBe(true);
		for (const s of stops) expect(s.visible, `no visible focus on ${JSON.stringify(s)}`).toBe(true);
		expect(stops[1].skip || stops[2].skip).toBe(false);
	});

	test('the skip link moves focus to main', async ({ page }) => {
		await open(page, TARGETS.find((t) => t.name === 'home')!);
		await page.keyboard.press('Tab');
		await page.keyboard.press('Enter');
		expect(await page.evaluate(() => document.activeElement?.id)).toBe('main');
		expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe('main');
	});

	test.describe('with the sidebar', () => {
		test.use({ viewport: VIEWPORTS[1] });

		test('Tab order is skip link, then the sidebar, then the main content', async ({ page }) => {
			await open(page, TARGETS.find((t) => t.name === 'leaderboard')!);
			const stops: Stop[] = [];
			for (let i = 0; i < 40; i++) {
				await page.keyboard.press('Tab');
				const s = await page.evaluate(describeFocus);
				stops.push(s);
				if (s.main) break;
			}
			expect(stops[0].skip, JSON.stringify(stops[0])).toBe(true);
			const firstMain = stops.findIndex((s) => s.main);
			expect(firstMain, 'main content is reached').toBeGreaterThan(0);
			const between = stops.slice(1, firstMain);
			expect(between.length, 'nav items between the skip link and main').toBeGreaterThanOrEqual(6);
			expect(between.every((s) => s.sidebar), JSON.stringify(between.map((s) => s.text))).toBe(true);
			for (const s of stops) expect(s.visible, `no visible focus on ${JSON.stringify(s)}`).toBe(true);
		});
	});
});

// ---------------------------------------------------------------- reduced motion

test.describe('reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const [label, path, role] of [
		['Home', '/', 'member'],
		['Feed', '/feed', 'member'],
		['the admin shell', '/admin/review', 'admin']
	] as const) {
		for (const viewport of VIEWPORTS) {
			test(`${label} at ${viewport.width}px runs no animation or transition longer than 1 ms`, async ({ page }) => {
				await page.setViewportSize(viewport);
				await open(page, { name: label, path, role });
				await page.waitForTimeout(400);
				const running = await page.evaluate(() =>
					document
						.getAnimations()
						.filter((a) => {
							const t = a.effect?.getComputedTiming();
							return !!t && Number(t.duration) > 1;
						})
						.map((a) => `${a.constructor.name} ${(a.effect as KeyframeEffect).target?.tagName}.${(a.effect as KeyframeEffect).target?.className}`)
				);
				expect(running).toEqual([]);
			});
		}
	}
});

// ---------------------------------------------------------------- focus rings inside scroll containers

/**
 * Focuses every focusable element of the region and checks that its focus ring (outline plus
 * offset) is not cut off by an ancestor with `overflow` other than visible.
 */
async function clippedRings(page: Page, regionSelector: string): Promise<string[]> {
	const count = await page.locator(`${regionSelector} :is(a[href], button, input, select, textarea)`).count();
	expect(count, `focusable elements in ${regionSelector}`).toBeGreaterThan(0);
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		await page.keyboard.press('Tab'); // establish keyboard modality
		await page.locator(`${regionSelector} :is(a[href], button, input, select, textarea)`).nth(i).focus();
		out.push(
			...(await page.evaluate(() => {
				const active = document.activeElement as HTMLElement;
				// the ring may sit on a wrapper of the focused element (segmented radios)
				let ringEl: HTMLElement | null = active;
				for (let n = 0; n < 3 && ringEl; n++) {
					if (getComputedStyle(ringEl).outlineStyle !== 'none') break;
					ringEl = ringEl.parentElement;
				}
				if (!ringEl || getComputedStyle(ringEl).outlineStyle === 'none') {
					return [`no outline on ${active.tagName} ${active.textContent?.trim().slice(0, 20)}`];
				}
				const cs = getComputedStyle(ringEl);
				const grow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
				const r = ringEl.getBoundingClientRect();
				const ring = { l: r.left - grow, t: r.top - grow, r: r.right + grow, b: r.bottom + grow };
				const bad: string[] = [];
				for (let p = ringEl.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
					const s = getComputedStyle(p);
					const clipX = s.overflowX !== 'visible';
					const clipY = s.overflowY !== 'visible';
					if (!clipX && !clipY) continue;
					const pr = p.getBoundingClientRect();
					const box = { l: pr.left + p.clientLeft, t: pr.top + p.clientTop, r: pr.left + p.clientLeft + p.clientWidth, b: pr.top + p.clientTop + p.clientHeight };
					if ((clipX && (ring.l < box.l - 0.5 || ring.r > box.r + 0.5)) || (clipY && (ring.t < box.t - 0.5 || ring.b > box.b + 0.5))) {
						bad.push(`ring of ${active.tagName} "${active.textContent?.trim().slice(0, 20)}" clipped by ${p.tagName.toLowerCase()}.${p.className}`);
					}
				}
				return bad;
			}))
		);
	}
	return out;
}

test.describe('focus rings are not clipped', () => {
	test.use({ viewport: VIEWPORTS[0], reducedMotion: 'reduce' });

	test('admin section navigation', async ({ page }) => {
		await open(page, TARGETS.find((t) => t.name === 'admin review')!);
		expect(await clippedRings(page, 'nav[aria-label="Admin sections"]')).toEqual([]);
	});

	test('bottom tab bar', async ({ page }) => {
		await open(page, TARGETS.find((t) => t.name === 'home')!);
		expect(await clippedRings(page, 'nav.tabbar')).toEqual([]);
	});

	test('segmented controls', async ({ page }) => {
		await open(page, TARGETS.find((t) => t.name === 'leaderboard')!);
		expect(await clippedRings(page, '.seg')).toEqual([]);
	});
});
