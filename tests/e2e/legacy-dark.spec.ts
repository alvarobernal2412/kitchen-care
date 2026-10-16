import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema';
import { createUser, db, getUser, giveSession, lowestContrast } from './helpers';

// Interim guard: screens that are not restyled yet hard-code light backgrounds. In dark mode their
// text must still be readable (the legacy shim pins them to the light look). Delete with the shim.

test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

const userIds: number[] = [];
const periodIds: number[] = [];

test.afterEach(async () => {
	for (const id of userIds.splice(0)) {
		await db.delete(schema.periodWinners).where(eq(schema.periodWinners.userId, id));
		await db.delete(schema.posts).where(eq(schema.posts.userId, id));
		await db.delete(schema.submissions).where(eq(schema.submissions.userId, id));
	}
	for (const id of periodIds.splice(0)) {
		await db.delete(schema.periodWinners).where(eq(schema.periodWinners.periodId, id));
		await db.delete(schema.periods).where(eq(schema.periods.id, id));
	}
});

async function signedIn(page: Page) {
	const creds = await createUser();
	const user = await getUser(creds.username);
	userIds.push(user.id);
	await giveSession(page.context(), creds.username, creds.password);
	return user.id;
}

test('the profile page stays readable in dark mode', async ({ page }) => {
	await signedIn(page);
	await page.goto('/profile');
	await expect(page.getByRole('main')).toBeVisible();
	const r = await lowestContrast(page, 'main');
	expect(r.ratio, `profile text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
});

test('the checker itself fails on light text over a white card', async ({ page }) => {
	await signedIn(page);
	await page.goto('/profile');
	await page.evaluate(() => {
		const d = document.createElement('div');
		d.id = 'probe';
		d.style.cssText = 'background:#fff;color:#e8ede6';
		d.textContent = 'light on white';
		document.body.append(d);
	});
	const r = await lowestContrast(page, '#probe');
	expect(r.ratio).toBeLessThan(4.5);
});
