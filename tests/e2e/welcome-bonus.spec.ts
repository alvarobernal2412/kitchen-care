import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema';
import { createUser, db, getUser, giveSession, grantBonusTo } from './helpers';

// The web server runs with the sign-up offer switched off (WELCOME_BONUS_UNTIL in the past, see
// playwright.config.ts), so the bonus is granted here through the service function instead.

const TASK_ORDER = ['cutlery', 'dishwasher', 'grounds', 'milk', 'beans', 'descale', 'deep_clean'];
const created: number[] = [];

test.afterEach(async () => {
	for (const id of created.splice(0)) {
		await db.delete(schema.submissions).where(eq(schema.submissions.userId, id));
	}
});

async function userWithBonus(page: import('@playwright/test').Page) {
	const { username, password } = await createUser();
	expect(await grantBonusTo(username)).toBe(true);
	created.push((await getUser(username)).id);
	await giveSession(page.context(), username, password);
	return username;
}

test('Home shows the bonus under the user\'s submissions and in the total', async ({ page }) => {
	await userWithBonus(page);
	await page.goto('/');
	const mine = page.getByRole('region', { name: 'Your submissions' });
	const row = mine.getByRole('listitem').filter({ hasText: 'Welcome bonus' });
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('Approved +10');
	await expect(page.getByTestId('credit-total')).toHaveText('10');
	await expect(page.getByRole('link', { name: /Welcome bonus/ })).toHaveCount(0);
});

test('the chore grid still has exactly the seven tiles', async ({ page }) => {
	await userWithBonus(page);
	await page.goto('/');
	const tiles = page.locator('.tiles > *');
	await expect(tiles).toHaveCount(TASK_ORDER.length);
	await expect(page.locator('.tiles')).not.toContainText('Welcome bonus');
});

test('the public "Recent in the kitchen" list does not mention it', async ({ page }) => {
	await userWithBonus(page);
	await page.goto('/');
	const recent = page.getByRole('region', { name: 'Recent in the kitchen' });
	await expect(recent).toBeVisible();
	await expect(recent).not.toContainText('Welcome bonus');
	await expect(recent).not.toContainText('welcome');
});

test('the leaderboard lists the user with 10 points', async ({ page }) => {
	const username = await userWithBonus(page);
	await page.goto('/leaderboard');
	const row = page.getByRole('listitem').filter({ hasText: username });
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('10');
});

test('the sign-up page shows no offer while the offer is off', async ({ page }) => {
	await page.goto('/signup');
	await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
	await expect(page.getByText(/start with \d+ credits/)).toHaveCount(0);
	await expect(page.getByTestId('welcome-offer')).toHaveCount(0);
});
