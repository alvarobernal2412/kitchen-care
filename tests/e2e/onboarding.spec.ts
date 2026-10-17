import { expect, test } from '@playwright/test';
import { E2E_ORIGIN } from './env';
import { createUser, getUser, giveSession, signUp, uniqueUsername } from './helpers';

const HOME = `${E2E_ORIGIN}/`;
const SLOGAN = "Good karma pays out: Rack up your credits for this semester's grand reward.";

test('a new user sees the carousel once, then goes straight home', { tag: '@smoke' }, async ({ page }) => {
	const username = uniqueUsername('onb');
	await signUp(page, username);

	await expect(page).toHaveURL(/\/onboarding$/);
	await expect(page.getByRole('heading', { name: 'How credits work' })).toBeVisible();
	await expect(page.getByText(SLOGAN)).toBeVisible();
	await expect(page.getByText('+15')).toBeVisible(); // points table from the task definitions
	await expect(page.getByText('Step 1 of 3')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your karma' })).toBeHidden();

	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByRole('heading', { name: 'Your karma' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'How credits work' })).toBeHidden();

	await page.getByRole('button', { name: 'Back' }).click();
	await expect(page.getByRole('heading', { name: 'How credits work' })).toBeVisible();

	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByRole('heading', { name: 'Semester prize' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Next' })).toBeHidden();

	await page.getByRole('button', { name: 'Get started' }).click();
	await expect(page).toHaveURL(HOME);
	expect((await getUser(username)).onboardingCompleted).toBe(true);
	expect(await page.evaluate(() => localStorage.getItem('kc.onboarding_completed'))).toBe('1');

	await page.reload();
	await expect(page).toHaveURL(HOME);

	// The DB flag wins: with storage cleared the user is still not sent back.
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await expect(page).toHaveURL(HOME);
	await page.goto('/feed');
	await expect(page).toHaveURL(/\/feed$/);
});

test('skipping completes onboarding', async ({ page }) => {
	const username = uniqueUsername('skip');
	await signUp(page, username);
	await expect(page).toHaveURL(/\/onboarding$/);
	await page.getByRole('button', { name: 'Skip' }).click();
	await expect(page).toHaveURL(HOME);
	expect((await getUser(username)).onboardingCompleted).toBe(true);
});

test('the server ignores a localStorage hint when the DB flag is false', async ({ page }) => {
	const { username, password } = await createUser(uniqueUsername('hint'), { onboarded: false });
	await giveSession(page.context(), username, password);
	await page.addInitScript(() => localStorage.setItem('kc.onboarding_completed', '1'));
	await page.goto('/leaderboard');
	await expect(page).toHaveURL(/\/onboarding$/);
});

test('onboarding still completes when storage is unavailable', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'localStorage', {
			get() {
				throw new DOMException('denied', 'SecurityError');
			}
		});
	});
	const { username, password } = await createUser(uniqueUsername('nostore'), { onboarded: false });
	await giveSession(page.context(), username, password);
	await page.goto('/');
	await expect(page).toHaveURL(/\/onboarding$/);
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Get started' }).click();
	await expect(page).toHaveURL(HOME);
	expect((await getUser(username)).onboardingCompleted).toBe(true);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('all three steps are on one page and Get started works', { tag: '@smoke' }, async ({ page }) => {
		const username = uniqueUsername('nojs');
		await signUp(page, username);
		await expect(page).toHaveURL(/\/onboarding$/);
		await expect(page.getByRole('heading', { name: 'How credits work' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Your karma' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Semester prize' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Get started' }).click();
		await expect(page).toHaveURL(HOME);
		expect((await getUser(username)).onboardingCompleted).toBe(true);
	});
});
