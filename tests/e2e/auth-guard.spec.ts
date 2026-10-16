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
		expect(await res.json()).toEqual({ type: 'redirect', status: 303, location: '/login' });
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

	await page.getByRole('link', { name: 'Leaderboard' }).click();
	await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
	await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
	await expect(page.getByText(/internal error|500/i)).toHaveCount(0);
});

test('a signed-in non-admin gets 403 on admin pages', async ({ page }) => {
	await loginAsNewUser(page);
	const res = await page.goto('/admin/users');
	expect(res?.status()).toBe(403);
});

test('an admin can open the admin pages', async ({ page }) => {
	await loginAsAdmin(page);
	const res = await page.goto('/admin/users');
	expect(res?.status()).toBe(200);
});
