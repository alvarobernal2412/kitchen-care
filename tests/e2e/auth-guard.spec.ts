import { expect, test } from '@playwright/test';
import { E2E_ORIGIN } from './env';
import { dropSessions, loginAsAdmin, loginAsNewUser } from './helpers';

test.describe('anonymous visitors', () => {
	for (const path of ['/', '/feed', '/leaderboard', '/profile', '/admin/users']) {
		test(`${path} redirects to /login`, async ({ page }) => {
			await page.goto(path);
			await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
			await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
		});
	}

	test('API and media answer 401 JSON instead of redirecting', async ({ request }) => {
		const api = await request.get('/api/tasks/dishwasher', { maxRedirects: 0 });
		expect(api.status()).toBe(401);
		expect(await api.json()).toEqual({ error: 'unauthorized' });

		const media = await request.get(`/media/${'a'.repeat(32)}.webp`, { maxRedirects: 0 });
		expect(media.status()).toBe(401);
	});

	test('client-side data requests get a redirect payload, not a page-load error', async ({
		request
	}) => {
		// Page loads must not run for anonymous users, even when the layout load is skipped.
		const res = await request.get('/leaderboard/__data.json', { maxRedirects: 0 });
		expect(res.status()).toBe(200);
		expect(await res.json()).toMatchObject({ type: 'redirect', location: '/login' });
	});

	test('public pages stay reachable', async ({ page, request }) => {
		expect((await request.get('/healthz')).status()).toBe(200);
		await page.goto('/signup');
		await expect(page).toHaveURL(/\/signup$/);
		await page.goto('/reset-password');
		await expect(page).toHaveURL(/\/reset-password$/);
	});
});

test('an expired session during client-side navigation lands on /login without an error page', async ({
	page
}) => {
	const { username } = await loginAsNewUser(page);
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Leaderboard' })).toBeVisible();

	await dropSessions(username); // as if it had expired

	const dataResponse = page.waitForResponse((r) => r.url().includes('/leaderboard/__data.json'));
	await page.getByRole('link', { name: 'Leaderboard' }).click();
	expect(await (await dataResponse).json()).toMatchObject({ type: 'redirect', location: '/login' });
	await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
	await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
	await expect(page.getByText(/internal error|500/i)).toHaveCount(0);
});

test('an enhanced form action after the session expired lands on /login without an error page', async ({
	page
}) => {
	const { username, password } = await loginAsNewUser(page);
	await page.goto('/profile');
	await dropSessions(username);

	await page.getByRole('region', { name: 'Password' }).getByLabel('Current password').fill(password);
	await page.getByLabel('New password', { exact: true }).fill('Brand-New-Pass9#');
	await page.getByLabel('Confirm new password').fill('Brand-New-Pass9#');
	await page.getByRole('button', { name: 'Change password' }).click();

	await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
	await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
	await expect(page.getByText(/internal error|500/i)).toHaveCount(0);
});

test('the guard clears a stale session cookie', async ({ request }) => {
	const res = await request.get('/feed', {
		maxRedirects: 0,
		headers: { cookie: 'kc_session=stale-session-id' }
	});
	expect(res.status()).toBe(303);
	expect(res.headers()['location']).toBe('/login');
	const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
	expect(setCookie.some((h) => /^kc_session=;/.test(h.value) && /max-age=0/i.test(h.value))).toBe(true);
});

test('a signed-in non-admin gets 403 on admin pages', async ({ page }) => {
	await loginAsNewUser(page);
	const res = await page.goto('/admin/users');
	expect(res?.status()).toBe(403);
	await expect(page).toHaveURL(`${E2E_ORIGIN}/admin/users`);
});

test('an admin can open the admin pages', async ({ page }) => {
	await loginAsAdmin(page);
	const res = await page.goto('/admin/users');
	expect(res?.status()).toBe(200);
	await expect(page).toHaveURL(`${E2E_ORIGIN}/admin/users`);
});
