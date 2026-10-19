import { expect, test } from '@playwright/test';
import { E2E_ORIGIN } from './env';
import { createUser, giveSession, loginAsNewUser, overflowReport } from './helpers';

test('the privacy notice is public and linked from login and signup', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('link', { name: 'Privacy notice' }).click();
	await expect(page).toHaveURL(`${E2E_ORIGIN}/privacy`);
	await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
	await page.goto('/signup');
	await expect(page.getByRole('link', { name: 'privacy notice' })).toBeVisible();
});

test('a user can download their data', async ({ page }) => {
	const { username } = await loginAsNewUser(page);
	await page.goto('/profile');
	const download = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download my data' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('kitchen-care-my-data.json');
	const path = await file.path();
	const json = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'));
	expect(json.profile.username).toBe(username);
	expect(JSON.stringify(json)).not.toMatch(/password|hash/i);
});

test('a user can delete their account and can no longer sign in', async ({ page }) => {
	const { username, password } = await createUser();
	await giveSession(page.context(), username, password);
	await page.goto('/profile');
	await page.getByText('Delete my account').first().click();
	await page.locator('#deletePassword').fill('wrong-Password1!');
	await page.getByLabel('I understand this is permanent').check();
	await page.getByRole('button', { name: 'Delete my account' }).click();
	await expect(page.getByRole('alert')).toContainText('Password is incorrect');

	await page.locator('#deletePassword').fill(password);
	await page.getByLabel('I understand this is permanent').check();
	await page.getByRole('button', { name: 'Delete my account' }).click();
	await expect(page).toHaveURL(/\/login\?deleted=1/);
	await expect(page.getByText('Your account was deleted.')).toBeVisible();

	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByRole('alert')).toContainText('Invalid username or password');
});

test('privacy notice and data controls fit a phone screen', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const path of ['/privacy', '/login', '/signup']) {
		await page.goto(path);
		expect(await overflowReport(page), path).toEqual([]);
	}
	await loginAsNewUser(page);
	await page.goto('/profile');
	await page.getByText('Delete my account').first().click();
	expect(await overflowReport(page)).toEqual([]);
	for (const el of [
		page.getByRole('link', { name: 'Download my data' }),
		page.getByText('Delete my account').first()
	]) {
		const box = await el.boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
	}
	await page.screenshot({ path: 'test-results/profile-data-390.png', fullPage: true });
	await page.goto('/privacy');
	await page.screenshot({ path: 'test-results/privacy-390.png', fullPage: true });
});
