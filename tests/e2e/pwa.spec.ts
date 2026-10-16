import { expect, test, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { events } from '../../src/lib/server/db/schema';
import { E2E_ORIGIN } from './env';
import { createUser, db, dropSessions, getUser, giveSession, loginAsNewUser } from './helpers';

// Service workers are allowed (Playwright's default) for the whole suite, so every spec runs with
// the real worker registered; this file additionally asserts the PWA behaviour itself.

/** Loads the app signed in, waits for the worker, and reloads so it controls the page. */
async function getControlled(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

async function cachedUrls(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const urls: string[] = [];
		for (const name of await caches.keys()) {
			const cache = await caches.open(name);
			for (const r of await cache.keys()) urls.push(new URL(r.url).pathname + new URL(r.url).search);
		}
		return urls;
	});
}

test.describe('manifest and icons', () => {
	test('manifest is served as JSON with the required fields', async ({ request }) => {
		const res = await request.get('/manifest.webmanifest');
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toMatch(/application\/(manifest\+)?json/);
		const m = await res.json();
		expect(m).toMatchObject({
			name: 'Kitchen Care Credits',
			short_name: 'Kitchen Care',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			lang: 'en'
		});
		expect(m.description).toContain('Good karma pays out');
		expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
		expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
	});

	test('every manifest icon is reachable without a session and has the declared size', async ({
		request
	}) => {
		const m = await (await request.get('/manifest.webmanifest')).json();
		const purposes = m.icons.map((i: { purpose: string; sizes: string }) => `${i.purpose}:${i.sizes}`);
		expect(purposes).toEqual(expect.arrayContaining(['any:192x192', 'any:512x512', 'maskable:512x512']));
		for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
			const res = await request.get(icon.src, { maxRedirects: 0 });
			expect(res.status(), icon.src).toBe(200);
			expect(res.headers()['content-type']).toContain(icon.type);
			if (icon.type === 'image/png') {
				const meta = await sharp(await res.body()).metadata();
				expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
			}
		}
		const touch = await request.get('/icons/apple-touch-icon.png', { maxRedirects: 0 });
		expect(touch.status()).toBe(200);
		const meta = await sharp(await touch.body()).metadata();
		expect([meta.width, meta.height]).toEqual([180, 180]);
	});

	test('the page links the manifest and Chromium finds no installability errors', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
		await page.evaluate(() => navigator.serviceWorker.ready);

		const cdp = await page.context().newCDPSession(page);
		const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
		expect(installabilityErrors).toEqual([]);
		const { errors: manifestErrors } = await cdp.send('Page.getAppManifest');
		expect(manifestErrors).toEqual([]);
	});
});

test.describe('service worker', () => {
	test('controls the page after the first visit and serves the offline page when offline', async ({
		page,
		context
	}) => {
		await loginAsNewUser(page);
		const failedAssets: string[] = [];
		page.on('requestfailed', (r) => {
			if (r.url().includes('/_app/') || r.url().includes('/icons/')) failedAssets.push(r.url());
		});
		await getControlled(page);

		await context.setOffline(true);
		try {
			await page.goto('/feed');
			await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
			await expect(page.getByText('needs a connection')).toBeVisible();
			// The icon on the offline page comes from the precache, not the network.
			await expect
				.poll(() => page.evaluate(() => (document.images[0] as HTMLImageElement).naturalWidth))
				.toBeGreaterThan(0);
		} finally {
			await context.setOffline(false);
		}
		expect(failedAssets).toEqual([]);

		await page.goto('/leaderboard');
		await expect(page.getByRole('heading', { name: "You're offline" })).toHaveCount(0);
		await expect(page).toHaveURL(`${E2E_ORIGIN}/leaderboard`);
		await expect(page.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
	});

	test('caches only shareable shell files, never private pages or data', async ({ page }) => {
		await loginAsNewUser(page);
		await getControlled(page);
		for (const path of ['/', '/feed', '/leaderboard', '/profile', '/history']) {
			await page.goto(path);
			await expect(page.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
		}
		// Client-side navigation fetches __data.json; make sure that happened too.
		await page.getByRole('link', { name: 'Leaderboard' }).click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/leaderboard`);
		// A media request (401/404 is fine: it must simply not be cached).
		await page.evaluate(() => fetch(`/media/${'a'.repeat(32)}.webp`).catch(() => null));

		const urls = await cachedUrls(page);
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url).not.toMatch(/\/api\/|\/media\/|__data\.json|\/feed|\/leaderboard|\/profile|\/admin|\/history/);
			expect(url).not.toBe('/');
			expect(url).toMatch(/^\/(_app\/|icons\/|offline\/|manifest\.webmanifest$|favicon)/);
		}
		expect(urls).toContain('/offline/index.html');
		expect(urls).toContain('/manifest.webmanifest');
	});

	test('a navigation under the worker still reaches the server and records app_open', async ({
		page
	}) => {
		// Get the worker controlling the page while still anonymous, so the fresh user's first
		// (unthrottled) document request is the one made under the worker.
		await page.goto('/login');
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.reload();
		await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
		const { username, password } = await createUser();
		await giveSession(page.context(), username, password);
		await page.goto('/');
		await expect(page.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
		const user = await getUser(username);
		const count = async () =>
			(
				await db
					.select()
					.from(events)
					.where(and(eq(events.userId, user.id), eq(events.type, 'app_open')))
			).length;
		await expect.poll(count).toBe(1);

		// The throttle (30 min) now blocks further events, so assert the request is network-bound
		// instead: the document GET arrives at the server with the page's session.
		const served = page.waitForResponse(
			(r) => new URL(r.url()).pathname === '/feed' && r.request().resourceType() === 'document'
		);
		await page.goto('/feed');
		const res = await served;
		expect(res.status()).toBe(200);
		expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
		expect(await count()).toBe(1);
	});

	test('an expired session during client navigation still lands on /login under the worker', async ({
		page
	}) => {
		const { username } = await loginAsNewUser(page);
		await getControlled(page);
		await dropSessions(username);

		await page.getByRole('link', { name: 'Leaderboard' }).click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
		await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

		// A full navigation with a dead session is redirected by the server, not cached.
		await page.goto('/feed');
		await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
	});
});
