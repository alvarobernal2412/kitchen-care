import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { E2E_ORIGIN } from './env';
import { createUser, getUser, giveSession, loginAsNewUser, overflowReport, uniqueUsername } from './helpers';

const NEW_PASSWORD = 'Brand-New-Pass9#';

async function testImage(width: number, height: number) {
	return sharp({ create: { width, height, channels: 3, background: '#cc6633' } })
		.png()
		.toBuffer();
}

test('changing the password signs out other devices but keeps this one', { tag: '@smoke' }, async ({
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
	await page.getByRole('region', { name: 'Password' }).getByLabel('Current password').fill('Wrong-Pass-1!');
	await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('alert')).toContainText('Current password is incorrect');

	await page.getByRole('region', { name: 'Password' }).getByLabel('Current password').fill(password);
	await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel('Confirm new password').fill('Different-Pass-1!');
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByRole('alert')).toContainText('do not match');

	await page.getByRole('region', { name: 'Password' }).getByLabel('Current password').fill(password);
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

	const avatar = page.getByTestId('avatar').locator('img');
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

const usernameForm = (page: Page) => page.getByRole('region', { name: 'Username' });

test.describe('changing the username', () => {
	test('shows the new name in the sidebar and on the leaderboard', async ({ page }) => {
		const { username, password } = await loginAsNewUser(page);
		const logged = await page.request.post('/api/tasks/dishwasher', {
			headers: { origin: E2E_ORIGIN }
		});
		expect(logged.ok()).toBe(true);
		const next = uniqueUsername('Renamed');
		await page.goto('/profile');
		const form = usernameForm(page);
		await expect(form.getByLabel('Username')).toHaveValue(username);
		await form.getByLabel('Username').fill(next);
		await form.getByLabel('Current password').fill(password);
		await form.getByRole('button', { name: 'Change username' }).click();
		const ok = page.getByRole('status').filter({ hasText: 'Username changed to' });
		await expect(ok).toHaveText(`Username changed to ${next}.`);
		await expect(ok).toHaveAttribute('aria-live', 'polite');
		await expect(page.locator('.who-name')).toHaveText(next);
		await expect(page.getByRole('main').locator('.name')).toHaveText(next);
		await page.goto('/leaderboard');
		await expect(page.getByRole('listitem').filter({ hasText: next }).first()).toBeVisible();
		await expect(page.getByText(username, { exact: true })).toHaveCount(0);
	});

	test('a taken name shows an error tied to the field', async ({ page }) => {
		const { password } = await loginAsNewUser(page);
		const other = await createUser();
		await page.goto('/profile');
		const form = usernameForm(page);
		const input = form.getByLabel('Username');
		await input.fill(other.username.toUpperCase());
		await form.getByLabel('Current password').fill(password);
		await form.getByRole('button', { name: 'Change username' }).click();
		const alert = form.getByRole('alert');
		await expect(alert).toHaveText('That username is taken.');
		await expect(input).toHaveAttribute('aria-invalid', 'true');
		const id = await input.getAttribute('aria-describedby');
		expect(id).toBeTruthy();
		await expect(page.locator(`[id="${id}"]`)).toHaveText('That username is taken.');
		await expect(input).toHaveValue(other.username.toUpperCase());
	});

	test('a wrong current password is rejected and the name stays', async ({ page }) => {
		const { username } = await loginAsNewUser(page);
		await page.goto('/profile');
		const form = usernameForm(page);
		await form.getByLabel('Username').fill(uniqueUsername('nope'));
		const pw = form.getByLabel('Current password');
		await pw.fill('Wrong-Pass-1!');
		await form.getByRole('button', { name: 'Change username' }).click();
		await expect(form.getByRole('alert')).toHaveText('Current password is incorrect.');
		await expect(pw).toHaveAttribute('aria-invalid', 'true');
		await expect(pw).toHaveValue('');
		expect((await getUser(username)).displayUsername).toBe(username);
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('submitting renames and reports success', async ({ page }) => {
			const { password } = await loginAsNewUser(page);
			const next = uniqueUsername('nojs');
			await page.goto('/profile');
			const form = usernameForm(page);
			await form.getByLabel('Username').fill(next);
			await form.getByLabel('Current password').fill(password);
			await form.getByRole('button', { name: 'Change username' }).click();
			await expect(page.getByRole('status').filter({ hasText: 'Username changed to' })).toHaveText(
				`Username changed to ${next}.`
			);
			await expect(page.locator('.who-name')).toHaveText(next);
			expect((await getUser(next)).displayUsername).toBe(next);
		});

		test('a bad name is reported inline and the typed name is kept', async ({ page }) => {
			const { password } = await loginAsNewUser(page);
			await page.goto('/profile');
			const form = usernameForm(page);
			await form.getByLabel('Username').fill('no spaces');
			await form.getByLabel('Current password').fill(password);
			await form.getByRole('button', { name: 'Change username' }).click();
			await expect(form.getByRole('alert')).toContainText('3-32 characters');
			await expect(form.getByLabel('Username')).toHaveValue('no spaces');
		});
	});

	test('has no horizontal overflow at 390x844', async ({ page }) => {
		await loginAsNewUser(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/profile');
		const form = usernameForm(page);
		await form.getByLabel('Username').fill('x'.repeat(32));
		await form.getByLabel('Current password').fill('wrong-pass');
		await form.getByRole('button', { name: 'Change username' }).click();
		await expect(form.getByRole('alert')).toBeVisible();
		expect(await overflowReport(page)).toEqual([]);
	});
});
