import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema';
import { createUser, db, getUser, giveSession } from './helpers';

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

/** Lowest WCAG contrast ratio between any text in the container and the background it sits on. */
async function lowestContrast(page: Page, selector: string) {
	return page.locator(selector).first().evaluate((root) => {
		const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
		const lum = (c: number[]) => {
			const [r, g, b] = c.slice(0, 3).map((v) => {
				const x = v / 255;
				return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const bgOf = (el: Element | null): number[] => {
			for (let e = el; e; e = e.parentElement) {
				const c = parse(getComputedStyle(e).backgroundColor);
				if (c.length >= 3 && (c.length === 3 || c[3] > 0.5)) return c;
			}
			return [255, 255, 255];
		};
		let lowest = { ratio: 21, text: '' };
		const walk = (el: Element) => {
			const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
			if (hasText && (el as HTMLElement).offsetParent !== null) {
				const fg = parse(getComputedStyle(el).color);
				const a = lum(fg);
				const b = lum(bgOf(el));
				const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
				if (ratio < lowest.ratio) lowest = { ratio, text: el.textContent!.trim().slice(0, 30) };
			}
			for (const child of el.children) walk(child);
		};
		walk(root);
		return lowest;
	});
}

test('the leaderboard stays readable in dark mode', async ({ page }) => {
	const id = await signedIn(page);
	const [p] = await db.select().from(schema.periods).where(eq(schema.periods.status, 'active'));
	await db.insert(schema.submissions).values({
		userId: id,
		taskKey: 'milk',
		periodId: p.id,
		status: 'approved',
		pointsAwarded: 3
	});
	await page.goto('/leaderboard');
	await expect(page.locator('ol li').first()).toBeVisible();
	const row = await lowestContrast(page, 'ol li');
	expect(row.ratio, `row text "${row.text}"`).toBeGreaterThanOrEqual(4.5);
	const mine = await lowestContrast(page, 'ol li.me');
	expect(mine.ratio, `own row text "${mine.text}"`).toBeGreaterThanOrEqual(4.5);
});

test('history cards stay readable in dark mode', async ({ page }) => {
	const id = await signedIn(page);
	const [old] = await db
		.insert(schema.periods)
		.values({ name: 'Legacy contrast period', startsAt: new Date(), endsAt: new Date(), status: 'ended' })
		.returning();
	periodIds.push(old.id);
	await db.insert(schema.periodWinners).values({ periodId: old.id, userId: id, points: 7, rank: 1 });
	await page.goto('/history');
	await expect(page.getByText('Legacy contrast period')).toBeVisible();
	const card = await lowestContrast(page, 'ul li');
	expect(card.ratio, `card text "${card.text}"`).toBeGreaterThanOrEqual(4.5);
});

test('feed posts stay readable in dark mode', async ({ page }) => {
	const id = await signedIn(page);
	await db.insert(schema.posts).values({ userId: id, body: 'Dark mode contrast check' });
	await page.goto('/feed');
	await expect(page.getByText('Dark mode contrast check')).toBeVisible();
	const post = await lowestContrast(page, 'article');
	expect(post.ratio, `post text "${post.text}"`).toBeGreaterThanOrEqual(4.5);
});

test('the checker itself fails on light text over a white card', async ({ page }) => {
	await signedIn(page);
	await page.goto('/history');
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
