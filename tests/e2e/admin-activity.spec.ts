import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema';
import { E2E_ORIGIN } from './env';
import {
	createUser,
	db,
	getUser,
	giveSession,
	loginAsAdmin,
	lowestContrast,
	overflowReport,
	uniqueUsername
} from './helpers';

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

const createdUsers: number[] = [];

// The e2e database is shared by every spec: remove what a test made so ranks and queues stay clean.
test.afterEach(async () => {
	const ids = createdUsers.splice(0);
	if (ids.length === 0) return;
	await db.delete(schema.submissions).where(inArray(schema.submissions.userId, ids));
});

async function member(prefix = 'act') {
	const creds = await createUser(uniqueUsername(prefix));
	const user = await getUser(creds.username);
	createdUsers.push(user.id);
	return { ...creds, id: user.id };
}

async function activePeriodId(): Promise<number> {
	const [p] = await db.select().from(schema.periods).where(eq(schema.periods.status, 'active'));
	return p.id;
}

async function approved(userId: number, task: string, points: number, ageSeconds = 60) {
	const [row] = await db
		.insert(schema.submissions)
		.values({
			userId,
			taskKey: task,
			periodId: await activePeriodId(),
			status: 'approved',
			pointsAwarded: points,
			createdAt: new Date(Date.now() - ageSeconds * 1000)
		})
		.returning();
	return row;
}

const rowOf = (page: Page, username: string) =>
	page.locator('.rows > li').filter({ has: page.locator('.who b', { hasText: username }) });

/** Opens the "Remove points" disclosure of a row and fills the reason (the box is left to the caller). */
async function openRemoval(row: Locator, reason: string) {
	await row.locator('summary').click();
	await row.getByLabel(/^Reason/).fill(reason);
}

test.describe('admin activity', () => {
	test.use({ viewport: LAPTOP });

	test('an admin removes a chore: it is marked removed and the member sees it', async ({
		page,
		browser
	}) => {
		const m = await member();
		await approved(m.id, 'dishwasher', 2, 600);
		await approved(m.id, 'cutlery', 1, 300);
		await loginAsAdmin(page);
		await page.goto(`/admin/activity?user=${m.username}`);

		await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
		await expect(rowOf(page, m.username)).toHaveCount(2);

		const row = rowOf(page, m.username).filter({ hasText: 'Empty or run dishwasher' });
		await expect(row).toContainText('+2');
		const box = row.locator('input[name="confirm"]');
		await expect(box).not.toBeChecked();
		await openRemoval(row, 'It was already empty');
		await box.check();
		await row.getByRole('button', { name: 'Remove points', exact: true }).click();

		await expect(page.getByRole('status').filter({ hasText: 'Points removed' })).toBeVisible();
		// the row left the default list; the filter survived the round trip
		await expect(rowOf(page, m.username)).toHaveCount(1);
		await expect(page.locator('#f-user')).toHaveValue(m.username);

		await page.goto(`/admin/activity?user=${m.username}&removed=1`);
		const gone = rowOf(page, m.username).filter({ hasText: 'Empty or run dishwasher' });
		await expect(gone).toContainText('Removed by e2eadmin: It was already empty');
		await expect(gone.getByRole('button', { name: 'Remove points' })).toHaveCount(0);

		const [stored] = await db
			.select()
			.from(schema.submissions)
			.where(eq(schema.submissions.taskKey, 'dishwasher'))
			.then((r) => r.filter((s) => s.userId === m.id));
		expect(stored).toMatchObject({ status: 'revoked', revokeReason: 'It was already empty' });

		// the member's Home: lower total, the reason, the chore available again
		const ctx = await browser.newContext({ viewport: PHONE });
		try {
			await giveSession(ctx, m.username, m.password);
			const home = await ctx.newPage();
			await home.goto('/');
			await expect(home.getByTestId('credit-total')).toHaveText('1');
			const mine = home.locator('.mine li').filter({ hasText: 'Empty or run dishwasher' });
			await expect(mine).toContainText('Removed');
			await expect(mine).toContainText('Removed by admin: It was already empty');
			await expect(home.locator('.chore[data-task="dishwasher"]')).toHaveAttribute('data-state', 'ready');
		} finally {
			await ctx.close();
		}
	});

	test('the server refuses a removal without the confirmation or without a reason', async ({ page }) => {
		const m = await member();
		const sub = await approved(m.id, 'dishwasher', 2);
		await loginAsAdmin(page);
		await page.goto(`/admin/activity?user=${m.username}`);
		// the browser's own `required` checks would stop us first: lift them to reach the server
		await page.locator('form.remove').evaluateAll((forms) => {
			for (const f of forms as HTMLFormElement[]) {
				f.noValidate = true;
			}
		});

		// no tick
		const row = rowOf(page, m.username);
		await openRemoval(row, 'Because');
		await row.getByRole('button', { name: 'Remove points', exact: true }).click();
		await expect(row.getByRole('alert')).toContainText('Tick the box to confirm');

		// ticked, but no reason
		await row.getByLabel(/^Reason/).fill('   ');
		await row.locator('input[name="confirm"]').check();
		await row.getByRole('button', { name: 'Remove points', exact: true }).click();
		await expect(row.getByRole('alert')).toContainText('Add a reason');

		const [after] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, sub.id));
		expect(after.status).toBe('approved');
	});

	test('non-admins get 403 on the page and on the action', async ({ page }) => {
		const m = await member();
		const sub = await approved(m.id, 'dishwasher', 2);
		await giveSession(page.context(), m.username, m.password);
		const res = await page.goto('/admin/activity');
		expect(res?.status()).toBe(403);
		const post = await page.request.post('/admin/activity?/revoke', {
			headers: { origin: E2E_ORIGIN },
			form: { submissionId: String(sub.id), reason: 'nope', confirm: 'yes' }
		});
		expect(post.status()).toBe(403);
		const [after] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, sub.id));
		expect(after.status).toBe('approved');
	});

	test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
		await page.goto('/admin/activity');
		await expect(page).toHaveURL(/\/login/);
	});

	test('shows the empty states, and the Users page links here', async ({ page }) => {
		const m = await member();
		await loginAsAdmin(page);
		await page.goto(`/admin/activity?user=${m.username}`);
		await expect(
			page.getByText('Nothing to review. Approved chores of the running period show up here.')
		).toBeVisible();

		await page.goto(`/admin/users?q=${m.username}`);
		await page.locator('summary', { hasText: 'Actions' }).first().click();
		await page.getByRole('link', { name: `View activity of ${m.username}` }).click();
		await expect(page).toHaveURL(new RegExp(`/admin/activity\\?user=${m.username}`));
		await expect(page.locator('#f-user')).toHaveValue(m.username);
	});

	test('with no running period it says so', async ({ page }) => {
		await loginAsAdmin(page);
		const id = await activePeriodId();
		await db.update(schema.periods).set({ status: 'ended', endsAt: new Date() }).where(eq(schema.periods.id, id));
		try {
			await page.goto('/admin/activity');
			await expect(page.getByText('No period is running.')).toBeVisible();
			await expect(page.locator('.rows')).toHaveCount(0);
		} finally {
			await db.update(schema.periods).set({ status: 'active', endsAt: null }).where(eq(schema.periods.id, id));
		}
	});

	test('pages 25 at a time, newest first', async ({ page }) => {
		const m = await member();
		for (let i = 0; i < 27; i++) await approved(m.id, 'cutlery', 1, 1000 - i);
		await loginAsAdmin(page);
		await page.goto(`/admin/activity?user=${m.username}`);
		await expect(page.locator('.rows > li')).toHaveCount(25);
		await page.getByRole('link', { name: 'Load older' }).click();
		await expect(page.locator('.rows > li')).toHaveCount(2);
		await expect(page.getByRole('link', { name: 'Load older' })).toHaveCount(0);
		await page.getByRole('link', { name: /Back to newest/ }).click();
		await expect(page.locator('.rows > li')).toHaveCount(25);
	});
});

test.describe('admin activity without JavaScript', () => {
	test.use({ viewport: LAPTOP, javaScriptEnabled: false });

	test('the filters work as a plain GET form', async ({ page }) => {
		const a = await member('Zed');
		const b = await member('zoe');
		await approved(a.id, 'dishwasher', 2);
		await approved(b.id, 'cutlery', 1);
		await loginAsAdmin(page);
		await page.goto('/admin/activity');

		await page.locator('#f-user').fill(a.username.toUpperCase().slice(0, 7)); // case-insensitive
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect(page).toHaveURL(/user=/);
		await expect(rowOf(page, a.username)).toHaveCount(1);
		await expect(rowOf(page, b.username)).toHaveCount(0);

		await page.locator('#f-user').fill('');
		await page.locator('#f-task').selectOption('cutlery');
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect(page).toHaveURL(/task=cutlery/);
		await expect(rowOf(page, b.username)).toHaveCount(1);
		await expect(rowOf(page, a.username)).toHaveCount(0);
	});

	test('a % in the search is literal', async ({ page }) => {
		const a = await member();
		await approved(a.id, 'dishwasher', 2);
		await loginAsAdmin(page);
		await page.goto('/admin/activity?user=%25');
		await expect(rowOf(page, a.username)).toHaveCount(0);
	});

	test('a removal works without JavaScript and keeps the filter', async ({ page }) => {
		const a = await member();
		const sub = await approved(a.id, 'dishwasher', 2);
		await loginAsAdmin(page);
		await page.goto(`/admin/activity?user=${a.username}`);
		const row = rowOf(page, a.username);
		await openRemoval(row, 'Wrong person');
		await row.locator('input[name="confirm"]').check();
		await row.getByRole('button', { name: 'Remove points', exact: true }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Points removed' })).toBeVisible();
		await expect(page.locator('#f-user')).toHaveValue(a.username);
		const [after] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, sub.id));
		expect(after.status).toBe('revoked');
	});
});

for (const [name, viewport] of [
	['phone', PHONE],
	['laptop', LAPTOP]
] as const) {
	test.describe(`admin activity layout on a ${name}`, () => {
		test.use({ viewport });

		test('has no horizontal overflow, with long names and reasons', async ({ page }) => {
			const m = await member('w'.repeat(12));
			await approved(m.id, 'deep_clean', 15, 500);
			const gone = await approved(m.id, 'descale', 10, 400);
			await db
				.update(schema.submissions)
				.set({
					status: 'revoked',
					revokedAt: new Date(),
					revokedBy: (await getUser('e2eadmin')).id,
					revokeReason: 'x'.repeat(190)
				})
				.where(eq(schema.submissions.id, gone.id));
			await loginAsAdmin(page);
			await page.goto(`/admin/activity?user=${m.username}&removed=1`);
			await expect(rowOf(page, m.username)).toHaveCount(2);
			await page.locator('summary').first().click();
			expect(await overflowReport(page)).toEqual([]);
		});
	});
}

test.describe('admin activity in dark mode', () => {
	test.use({ viewport: PHONE, colorScheme: 'dark' });

	test('rows keep readable contrast', async ({ page }) => {
		const m = await member();
		await approved(m.id, 'milk', 3, 400);
		const gone = await approved(m.id, 'beans', 5, 300);
		await db
			.update(schema.submissions)
			.set({
				status: 'revoked',
				revokedAt: new Date(),
				revokedBy: (await getUser('e2eadmin')).id,
				revokeReason: 'blurry'
			})
			.where(eq(schema.submissions.id, gone.id));
		await loginAsAdmin(page);
		await page.goto(`/admin/activity?user=${m.username}&removed=1`);
		await page.locator('summary').first().click();
		const r = await lowestContrast(page, '.rows');
		expect(r.ratio, `activity text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
	});
});
