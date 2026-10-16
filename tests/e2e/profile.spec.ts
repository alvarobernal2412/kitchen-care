import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { E2E_ORIGIN } from './env';
import { createUser, getUser, giveSession, loginAsNewUser } from './helpers';

const NEW_PASSWORD = 'Brand-New-Pass9#';

async function testImage(width: number, height: number) {
	return sharp({ create: { width, height, channels: 3, background: '#cc6633' } })
		.png()
		.toBuffer();
}

test('changing the password signs out other devices but keeps this one', async ({
	page,
	browser
}) => {
	const { username, password } = await createUser();
	await giveSession(page.context(), username, password);
	const other = await browser.newContext();
	await giveSession(other, username, password);
	const otherPage = await other.newPage();
	await otherPage.goto('/');
	await expect(otherPage).toHaveURL(`${E2E_ORIGIN}/`);

	await page.goto('/profile');
	await page.getByLabel('Current password').fill('Wrong-Pass-1!');
	await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('alert')).toContainText('Current password is incorrect');

	await page.getByLabel('Current password').fill(password);
	await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel('Confirm new password').fill('Different-Pass-1!');
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('alert')).toContainText('do not match');

	await page.getByLabel('Current password').fill(password);
	await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Password changed' })).toBeVisible();

	// This session survives.
	await page.reload();
	await expect(page).toHaveURL(/\/profile$/);
	// The other device is signed out.
	await otherPage.reload();
	await expect(otherPage).toHaveURL(`${E2E_ORIGIN}/login`);
	await other.close();

	// The new password works for a fresh login, the old one does not.
	const fresh = await browser.newContext();
	const freshPage = await fresh.newPage();
	await freshPage.goto('/login');
	await freshPage.getByLabel('Username').fill(username);
	await freshPage.getByLabel('Password').fill(password);
	await freshPage.getByRole('button', { name: 'Log in' }).click();
	await expect(freshPage.getByRole('alert')).toBeVisible();
	await freshPage.getByLabel('Password').fill(NEW_PASSWORD);
	await freshPage.getByRole('button', { name: 'Log in' }).click();
	await expect(freshPage).toHaveURL(`${E2E_ORIGIN}/`);
	await fresh.close();
});

test('profile shows read-only account details', async ({ page }) => {
	const { username } = await loginAsNewUser(page);
	await page.goto('/profile');
	const main = page.getByRole('main');
	await expect(main.getByText(username, { exact: true })).toBeVisible();
	await expect(main.getByText('Student', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
});

test('uploading and removing an avatar', async ({ page }) => {
	const { username } = await loginAsNewUser(page);
	// Appear on the leaderboard: log a self-reported task.
	const logged = await page.request.post('/api/tasks/dishwasher', {
		headers: { origin: E2E_ORIGIN }
	});
	expect(logged.ok()).toBe(true);

	await page.goto('/profile');
	await expect(page.getByTestId('avatar')).toHaveCount(0);

	await page.locator('input[type=file]').setInputFiles({
		name: 'me.png',
		mimeType: 'image/png',
		buffer: await testImage(900, 600)
	});
	await expect(page.getByTestId('avatar-preview')).toBeVisible();
	await page.getByRole('button', { name: 'Save photo' }).click();

	const avatar = page.getByTestId('avatar');
	await expect(avatar).toBeVisible();
	await expect(avatar).toHaveAttribute('src', /^\/media\/[0-9a-f]{32}\.webp$/);
	// The image really loads from /media (naturalWidth is 0 for a broken image).
	await expect.poll(() => avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(512);
	const stored = (await getUser(username)).avatarPath;
	expect(stored).toMatch(/^[0-9a-f]{32}\.webp$/);
	await expect(avatar).toHaveAttribute('src', `/media/${stored}`);

	// Used on the leaderboard too.
	await page.goto('/leaderboard');
	const row = page.getByRole('listitem').filter({ hasText: username });
	await expect(row.locator('.avatar img')).toHaveAttribute('src', `/media/${stored}`);

	// Replacing deletes the old file's reference.
	await page.goto('/profile');
	await page.locator('input[type=file]').setInputFiles({
		name: 'again.png',
		mimeType: 'image/png',
		buffer: await testImage(300, 800)
	});
	await page.getByRole('button', { name: 'Save photo' }).click();
	await expect.poll(async () => (await getUser(username)).avatarPath).not.toBe(stored);
	const old = await page.request.get(`/media/${stored}`);
	expect(old.status()).toBe(404);

	// Removing falls back to initials.
	await page.getByRole('button', { name: 'Remove photo' }).click();
	await expect(page.getByTestId('avatar')).toHaveCount(0);
	expect((await getUser(username)).avatarPath).toBeNull();
	await page.goto('/leaderboard');
	await expect(
		page.getByRole('listitem').filter({ hasText: username }).locator('.avatar img')
	).toHaveCount(0);
});

test('a non-image upload is rejected with a message and no avatar is set', async ({ page }) => {
	const { username } = await loginAsNewUser(page);
	await page.goto('/profile');
	await page.locator('input[type=file]').setInputFiles({
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('hello')
	});
	await expect(page.getByRole('status')).toContainText('Could not read that image');
	expect((await getUser(username)).avatarPath).toBeNull();
});
