import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SESSION_COOKIE } from '../../src/lib/server/auth/session';
import { ADMIN_PASSWORD, ADMIN_USERNAME, E2E_ORIGIN } from '../../tests/e2e/env';
import { createUser, giveSession, uniqueUsername } from '../../tests/e2e/helpers';
import { seedShowcase, type Showcase } from '../../tests/e2e/showcase';

// Driven by scripts/screenshots.mjs (which passes SCREENSHOT_DIR). Not part of the e2e suite.
const OUT = resolve(process.env.SCREENSHOT_DIR ?? 'tmp/screenshots');

type Role = 'anon' | 'member' | 'admin' | 'fresh';
type Screen = { name: string; path: string; role: Role; prepare?: (page: Page) => Promise<void> };

const screens: Screen[] = [
	{ name: 'login', path: '/login', role: 'anon' },
	{ name: 'signup', path: '/signup', role: 'anon' },
	{ name: 'reset-password-invalid', path: '/reset-password?token=invalid', role: 'anon' },
	{ name: 'onboarding-1', path: '/onboarding', role: 'fresh' },
	{
		name: 'onboarding-2',
		path: '/onboarding',
		role: 'fresh',
		prepare: async (page) => {
			await page.getByRole('button', { name: 'Next' }).click();
		}
	},
	{
		name: 'onboarding-3',
		path: '/onboarding',
		role: 'fresh',
		prepare: async (page) => {
			await page.getByRole('button', { name: 'Next' }).click();
			await page.getByRole('button', { name: 'Next' }).click();
		}
	},
	{ name: 'home', path: '/', role: 'member' },
	{
		name: 'home-camera',
		path: '/',
		role: 'member',
		prepare: async (page) => {
			await page.locator('[data-task="beans"]').click();
			await expect(page.getByRole('dialog', { name: 'Take a photo' })).toBeVisible();
			await page.waitForTimeout(800);
		}
	},
	{ name: 'leaderboard', path: '/leaderboard', role: 'member' },
	{ name: 'leaderboard-employees', path: '/leaderboard?group=employees', role: 'member' },
	{ name: 'feed', path: '/feed', role: 'member' },
	{
		name: 'feed-comments',
		path: '/feed',
		role: 'member',
		prepare: async (page) => {
			await page.getByRole('button', { name: /comment/i }).first().click();
			await page.waitForTimeout(300);
		}
	},
	{ name: 'history', path: '/history', role: 'member' },
	{ name: 'profile', path: '/profile', role: 'member' },
	{ name: 'not-found', path: '/no-such-page', role: 'member' },
	{ name: 'offline', path: '/offline/', role: 'anon' },
	{ name: 'admin-review', path: '/admin/review', role: 'admin' },
	{ name: 'admin-users', path: '/admin/users', role: 'admin' },
	{ name: 'admin-moderation', path: '/admin/moderation', role: 'admin' },
	{ name: 'admin-images', path: '/admin/images', role: 'admin' },
	{ name: 'admin-periods', path: '/admin/periods', role: 'admin' },
	{ name: 'admin-analytics', path: '/admin/analytics', role: 'admin' }
];

const viewports = [
	{ width: 390, height: 844 },
	{ width: 1280, height: 800 }
];

let showcase: Showcase;
let fresh: { username: string; password: string };
const sessions = new Map<Role, string>();

test.beforeAll(async () => {
	showcase = await seedShowcase();
	fresh = await createUser(uniqueUsername('shots-fresh'), { onboarded: false });
});

test.afterAll(async () => {
	await showcase?.cleanup();
});

async function signIn(page: Page, role: Role) {
	if (role === 'anon') return;
	const creds =
		role === 'admin' ? { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } : role === 'fresh' ? fresh : showcase.me;
	const known = sessions.get(role);
	if (known) {
		await page.context().addCookies([{ name: SESSION_COOKIE, value: known, url: E2E_ORIGIN }]);
	} else {
		sessions.set(role, await giveSession(page.context(), creds.username, creds.password));
	}
}

for (const scheme of ['light', 'dark'] as const) {
	for (const viewport of viewports) {
		test.describe(`${scheme} ${viewport.width}`, () => {
			test.use({ colorScheme: scheme, viewport, permissions: ['camera'], reducedMotion: 'reduce' });

			test('every screen', async ({ page }) => {
				mkdirSync(OUT, { recursive: true });
				for (const screen of screens) {
					await page.context().clearCookies();
					await signIn(page, screen.role);
					await page.goto(screen.path);
					await page.waitForLoadState('networkidle');
					await screen.prepare?.(page);
					await page.waitForTimeout(250);
					await page.screenshot({
						path: join(OUT, `${screen.name}-${scheme}-${viewport.width}.png`),
						fullPage: true
					});
				}
			});
		});
	}
}
