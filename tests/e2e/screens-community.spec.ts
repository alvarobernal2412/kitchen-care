import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '../../src/lib/server/db/schema';
import { E2E_UPLOAD_DIR } from './env';
import { createUser, db, giveSession, lowestContrast, uniqueUsername } from './helpers';

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };
const SSPD = 'Software Systems Programming and Development';
const IRG = 'Interactions Research Group';

test.use({ viewport: PHONE });

const userIds: number[] = [];
const periodIds: number[] = [];

async function activePeriodId(): Promise<number> {
	const [p] = await db.select().from(schema.periods).where(eq(schema.periods.status, 'active'));
	return p.id;
}

/** Every spec in this file starts from an empty board and feed (other specs may leave rows). */
test.beforeEach(async () => {
	await db.delete(schema.posts);
	await db.delete(schema.submissions).where(eq(schema.submissions.periodId, await activePeriodId()));
});

test.afterEach(async () => {
	await db.delete(schema.posts);
	const ids = userIds.splice(0);
	if (ids.length) {
		await db.delete(schema.periodWinners).where(inArray(schema.periodWinners.userId, ids));
		await db.delete(schema.submissions).where(inArray(schema.submissions.userId, ids));
	}
	for (const id of periodIds.splice(0)) {
		await db.delete(schema.periodWinners).where(eq(schema.periodWinners.periodId, id));
		await db.delete(schema.submissions).where(eq(schema.submissions.periodId, id));
		await db.delete(schema.periods).where(eq(schema.periods.id, id));
	}
});

type Opts = {
	classification?: 'Student' | 'Employee';
	department?: typeof SSPD | typeof IRG;
	active?: boolean;
	displayName?: string;
};

async function mkUser(prefix: string, opts: Opts = {}) {
	const creds = await createUser(uniqueUsername(prefix));
	const [row] = await db
		.update(schema.users)
		.set({
			classification: opts.classification ?? 'Student',
			department: opts.department ?? null,
			active: opts.active ?? true,
			...(opts.displayName ? { displayUsername: opts.displayName } : {})
		})
		.where(eq(schema.users.usernameNormalized, creds.username.toLowerCase()))
		.returning();
	userIds.push(row.id);
	return { ...creds, id: row.id, name: row.displayUsername };
}

async function signIn(page: Page, u: { username: string; password: string }) {
	await giveSession(page.context(), u.username, u.password);
}

async function award(userId: number, points: number, taskKey = 'milk') {
	const [s] = await db
		.insert(schema.submissions)
		.values({
			userId,
			taskKey,
			periodId: await activePeriodId(),
			status: 'approved',
			pointsAwarded: points
		})
		.returning();
	return s;
}

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

async function expectNoOverflow(page: Page) {
	const result = await page.evaluate(() => {
		const vw = innerWidth;
		const wide: string[] = [];
		for (const el of document.querySelectorAll('main *')) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) {
				wide.push(`${el.tagName}.${(el as HTMLElement).className}`);
			}
		}
		return { scroll: document.documentElement.scrollWidth, vw, wide };
	});
	expect(result.scroll, 'document scrollWidth').toBeLessThanOrEqual(result.vw);
	expect(result.wide, 'elements outside the viewport').toEqual([]);
}

// ------------------------------------------------------------------ Leaderboard

test.describe('leaderboard', () => {
	test('shows the heading, prize text and the group filter', async ({ page }) => {
		const me = await mkUser('lb-me');
		await award(me.id, 5);
		await signIn(page, me);
		await page.goto('/leaderboard');
		await expect(page.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeVisible();
		await expect(page.getByText(/chips in for a prize/)).toBeVisible();
		await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
		const filter = page.getByRole('navigation', { name: 'Filter by group' });
		await expect(filter.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('link', { name: 'Past periods' })).toBeVisible();
		await expectNoOverflow(page);
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('the group chips and the department filter work as plain links and forms', async ({
			page
		}) => {
			const me = await mkUser('lb-me');
			const stu = await mkUser('lb-stu');
			const e1 = await mkUser('lb-e1', { classification: 'Employee', department: SSPD });
			const e2 = await mkUser('lb-e2', { classification: 'Employee', department: IRG });
			for (const u of [me, stu, e1, e2]) await award(u.id, 10);
			await signIn(page, me);
			await page.goto('/leaderboard');
			await expect(row(page, e1.name)).toBeVisible();

			await page.getByRole('link', { name: 'Students' }).click();
			await expect(page).toHaveURL(/group=students/);
			await expect(row(page, stu.name)).toBeVisible();
			await expect(row(page, e1.name)).toHaveCount(0);

			await page.getByRole('link', { name: 'Employees' }).click();
			await expect(page).toHaveURL(/group=employees/);
			await expect(row(page, e1.name)).toBeVisible();
			await expect(row(page, e2.name)).toBeVisible();
			await expect(row(page, stu.name)).toHaveCount(0);

			await page.getByLabel('Department').selectOption(IRG);
			await page.getByRole('button', { name: 'Apply' }).click();
			await expect(page).toHaveURL(/dept=Interactions/);
			await expect(row(page, e2.name)).toBeVisible();
			await expect(row(page, e1.name)).toHaveCount(0);
		});
	});

	test('the department filter appears for Employees only', async ({ page }) => {
		const me = await mkUser('lb-me');
		await award(me.id, 5);
		await signIn(page, me);
		await page.goto('/leaderboard');
		await expect(page.getByLabel('Department')).toHaveCount(0);
		await page.goto('/leaderboard?group=students');
		await expect(page.getByLabel('Department')).toHaveCount(0);
		await page.goto('/leaderboard?group=employees');
		await expect(page.getByLabel('Department')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Employees' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	});

	test('tied leaders both rank 1, the next rank is 3, and ties say so', async ({ page }) => {
		const a = await mkUser('lb-a');
		const b = await mkUser('lb-b');
		const c = await mkUser('lb-c');
		await award(a.id, 600);
		await award(b.id, 600);
		await award(c.id, 500);
		await signIn(page, c);
		await page.goto('/leaderboard');
		await expect(row(page, a.name).locator('.rank')).toHaveText('1');
		await expect(row(page, b.name).locator('.rank')).toHaveText('1');
		await expect(row(page, c.name).locator('.rank')).toHaveText('3');
		await expect(row(page, a.name)).toContainText('tied for 1st');
		await expect(row(page, b.name)).toContainText('tied for 1st');
		await expect(row(page, c.name)).not.toContainText('tied');
		// Leaders are bigger by type scale only.
		const big = await row(page, a.name).locator('.pts').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
		const small = await row(page, c.name).locator('.pts').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
		expect(big).toBeGreaterThan(small);
		await expect(page.locator('main svg')).toHaveCount(0);
	});

	test('the current user row says "you" in text and is marked for assistive tech', async ({
		page
	}) => {
		const other = await mkUser('lb-o');
		const me = await mkUser('lb-me');
		await award(other.id, 700);
		await award(me.id, 650);
		await signIn(page, me);
		await page.goto('/leaderboard');
		const mine = page.locator('li[aria-current="true"]');
		await expect(mine).toHaveCount(1);
		await expect(mine).toContainText(me.name);
		await expect(mine.getByText('you', { exact: true })).toBeVisible();
		await expect(row(page, other.name)).not.toHaveAttribute('aria-current', 'true');
		const bg = await mine.evaluate((e) => getComputedStyle(e).backgroundColor);
		const flat = await row(page, other.name).evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(bg).not.toBe(flat);
	});

	test('long names truncate and four-digit points stay visible at 360px', async ({ page }) => {
		const long = await mkUser('lb-long', { displayName: 'W'.repeat(60) });
		const big = await mkUser('lb-big');
		const me = await mkUser('lb-me');
		await award(long.id, 9876);
		await award(big.id, 1234);
		await award(me.id, 5);
		await signIn(page, me);
		await page.setViewportSize(SMALL);
		await page.goto('/leaderboard');
		const longRow = row(page, 'WWWWW');
		await expect(longRow).toBeVisible();
		const info = await longRow.evaluate((li) => {
			const name = li.querySelector('.name') as HTMLElement;
			const pts = li.querySelector('.pts') as HTMLElement;
			return {
				truncated: name.scrollWidth > name.clientWidth,
				nameRight: name.getBoundingClientRect().right,
				ptsLeft: pts.getBoundingClientRect().left,
				ptsRight: pts.getBoundingClientRect().right,
				ptsText: pts.textContent
			};
		});
		expect(info.truncated).toBe(true);
		expect(info.nameRight).toBeLessThanOrEqual(info.ptsLeft + 0.5);
		expect(info.ptsRight).toBeLessThanOrEqual(SMALL.width);
		expect(info.ptsText).toContain('9876');
		// Right edges of the points column line up across rows.
		const rights = await page.locator('.pts').evaluateAll((els) =>
			els.map((e) => Math.round(e.getBoundingClientRect().right))
		);
		expect(new Set(rights).size).toBe(1);
		await expectNoOverflow(page);
	});

	test('empty state invites the first log', async ({ page }) => {
		const me = await mkUser('lb-me');
		await signIn(page, me);
		await page.goto('/leaderboard');
		await expect(page.getByText('Nobody has credits yet. Log a chore to start the board.')).toBeVisible();
		await expect(page.getByRole('listitem')).toHaveCount(0);
	});

	test('laptop layout keeps the board readable and in bounds', async ({ page }) => {
		const a = await mkUser('lb-a');
		const me = await mkUser('lb-me');
		await award(a.id, 80);
		await award(me.id, 70);
		await signIn(page, me);
		await page.setViewportSize(LAPTOP);
		await page.goto('/leaderboard');
		const width = await page.locator('ol').first().evaluate((e) => e.getBoundingClientRect().width);
		expect(width).toBeLessThanOrEqual(641);
		await expectNoOverflow(page);
	});

	test.describe('dark mode', () => {
		test.use({ colorScheme: 'dark' });

		test('row text keeps WCAG AA contrast', async ({ page }) => {
			const a = await mkUser('lb-a');
			const b = await mkUser('lb-b');
			const me = await mkUser('lb-me');
			await award(a.id, 600);
			await award(b.id, 600);
			await award(me.id, 500);
			await signIn(page, me);
			await page.goto('/leaderboard');
			await expect(page.locator('ol li').first()).toBeVisible();
			const rows = await lowestContrast(page, 'ol');
			expect(rows.ratio, `row text "${rows.text}"`).toBeGreaterThanOrEqual(4.5);
			const mine = await lowestContrast(page, 'li[aria-current="true"]');
			expect(mine.ratio, `own row text "${mine.text}"`).toBeGreaterThanOrEqual(4.5);
			const head = await lowestContrast(page, 'main header');
			expect(head.ratio, `header text "${head.text}"`).toBeGreaterThanOrEqual(4.5);
		});
	});
});

// ------------------------------------------------------------------ History

test.describe('history', () => {
	test('lists past periods with winners, a tie and the participant count', async ({ page }) => {
		const a = await mkUser('h-a');
		const b = await mkUser('h-b');
		const c = await mkUser('h-c');
		const [old] = await db
			.insert(schema.periods)
			.values({
				name: 'Spring test period',
				startsAt: new Date('2026-02-01T00:00:00Z'),
				endsAt: new Date('2026-07-31T00:00:00Z'),
				status: 'ended'
			})
			.returning();
		periodIds.push(old.id);
		for (const [u, pts] of [[a, 40], [b, 40], [c, 12]] as const) {
			await db.insert(schema.submissions).values({
				userId: u.id,
				taskKey: 'milk',
				periodId: old.id,
				status: 'approved',
				pointsAwarded: pts
			});
		}
		await db.insert(schema.periodWinners).values([
			{ periodId: old.id, userId: a.id, points: 40, rank: 1 },
			{ periodId: old.id, userId: b.id, points: 40, rank: 1 }
		]);
		await signIn(page, a);
		await page.goto('/history');
		await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
		const section = page.locator('li').filter({ has: page.getByRole('heading', { name: 'Spring test period' }) });
		await expect(section.getByRole('heading', { level: 2 })).toHaveText('Spring test period');
		await expect(section).toContainText('2026-02-01');
		await expect(section).toContainText('3 participants');
		await expect(section).toContainText(a.name);
		await expect(section).toContainText(b.name);
		await expect(section).toContainText('40');
		await expect(section.getByText('Tied', { exact: false })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Current standings' }).first()).toBeVisible();
		await expectNoOverflow(page);
	});

	test('a single winner is not marked as tied', async ({ page }) => {
		const a = await mkUser('h-a');
		const [old] = await db
			.insert(schema.periods)
			.values({ name: 'Solo winner period', startsAt: new Date(), endsAt: new Date(), status: 'ended' })
			.returning();
		periodIds.push(old.id);
		await db.insert(schema.submissions).values({
			userId: a.id,
			taskKey: 'milk',
			periodId: old.id,
			status: 'approved',
			pointsAwarded: 7
		});
		await db.insert(schema.periodWinners).values({ periodId: old.id, userId: a.id, points: 7, rank: 1 });
		await signIn(page, a);
		await page.goto('/history');
		const section = page.locator('li').filter({ hasText: 'Solo winner period' });
		await expect(section).toContainText('1 participant');
		await expect(section).not.toContainText('Tied');
	});

	test('empty state', async ({ page }) => {
		const a = await mkUser('h-a');
		const ended = await db.select().from(schema.periods).where(eq(schema.periods.status, 'ended'));
		for (const p of ended) {
			await db.delete(schema.periodWinners).where(eq(schema.periodWinners.periodId, p.id));
			await db.delete(schema.submissions).where(eq(schema.submissions.periodId, p.id));
			await db.delete(schema.periods).where(eq(schema.periods.id, p.id));
		}
		await signIn(page, a);
		await page.goto('/history');
		await expect(page.getByText('No finished periods yet.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Current standings' }).first()).toBeVisible();
	});

	test.describe('dark mode', () => {
		test.use({ colorScheme: 'dark' });

		test('period sections keep WCAG AA contrast', async ({ page }) => {
			const a = await mkUser('h-a');
			const [old] = await db
				.insert(schema.periods)
				.values({ name: 'Contrast period', startsAt: new Date(), endsAt: new Date(), status: 'ended' })
				.returning();
			periodIds.push(old.id);
			await db.insert(schema.periodWinners).values({ periodId: old.id, userId: a.id, points: 7, rank: 1 });
			await signIn(page, a);
			await page.goto('/history');
			await expect(page.getByText('Contrast period')).toBeVisible();
			const r = await lowestContrast(page, 'main');
			expect(r.ratio, `text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
		});
	});
});

// ------------------------------------------------------------------ Feed

async function mkPost(
	userId: number,
	body: string,
	extra: { createdAt?: Date; imagePath?: string; milestone?: boolean } = {}
) {
	let milestoneSubmissionId: number | undefined;
	if (extra.milestone) milestoneSubmissionId = (await award(userId, 10, 'descale')).id;
	const [p] = await db
		.insert(schema.posts)
		.values({
			userId,
			body,
			imagePath: extra.imagePath ?? null,
			milestoneSubmissionId,
			...(extra.createdAt ? { createdAt: extra.createdAt } : {})
		})
		.returning();
	return p;
}

/** Writes a real WebP proof photo into the upload directory; returns its stored file name. */
async function writeProof(): Promise<string> {
	const file = `${randomBytes(16).toString('hex')}.webp`;
	await mkdir(E2E_UPLOAD_DIR, { recursive: true });
	const buf = await sharp({
		create: { width: 800, height: 600, channels: 3, background: '#7a8f86' }
	})
		.webp()
		.toBuffer();
	await writeFile(join(E2E_UPLOAD_DIR, file), buf);
	return file;
}

const article = (page: Page, text: string) =>
	page.getByRole('article').filter({ hasText: text });

test.describe('feed', () => {
	test('empty state', async ({ page }) => {
		const me = await mkUser('f-me');
		await signIn(page, me);
		await page.goto('/feed');
		await expect(page.getByRole('heading', { level: 1, name: 'Feed' })).toBeVisible();
		await expect(page.getByText('Nothing here yet. Post something or log a chore.')).toBeVisible();
	});

	test('a milestone post shows its text larger, with the proof photo in a fixed-ratio frame', async ({
		page
	}) => {
		const me = await mkUser('f-me');
		const lena = await mkUser('f-lena', { classification: 'Employee', department: IRG });
		const file = await writeProof();
		await mkPost(lena.id, `${lena.name} just did: Descale the coffee machine! 🎉`, {
			milestone: true,
			imagePath: file
		});
		await signIn(page, me);
		await page.goto('/feed');
		const post = article(page, 'Descale the coffee machine');
		await expect(post).toBeVisible();
		const img = post.getByRole('img', { name: /Proof photo/ });
		await expect(img).toBeVisible();
		await expect(img).toHaveAttribute('loading', 'lazy');
		await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
		const box = await img.evaluate((e) => {
			const frame = e.parentElement!;
			const r = frame.getBoundingClientRect();
			return { ratio: r.width / r.height, radius: getComputedStyle(frame).borderRadius };
		});
		expect(box.ratio).toBeCloseTo(4 / 3, 1);
		expect(box.radius).toBe('10px');
		const headline = post.locator('.headline');
		const bodyPx = await headline.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
		expect(bodyPx).toBeGreaterThan(20);
		await expect(post).toContainText(IRG);
		await expectNoOverflow(page);
	});

	test('a broken proof photo is hidden without a broken-image icon', async ({ page }) => {
		const me = await mkUser('f-me');
		const lena = await mkUser('f-lena');
		await mkPost(lena.id, `${lena.name} just did: Deep clean! 🎉`, {
			milestone: true,
			imagePath: `${randomBytes(16).toString('hex')}.webp` // never written to disk
		});
		await signIn(page, me);
		await page.goto('/feed');
		const post = article(page, 'Deep clean');
		await expect(post).toBeVisible();
		await expect(post.locator('img')).toHaveCount(0);
		await expect(post.locator('.photo')).toHaveCount(0);
		await expect(post.getByRole('group', { name: 'Reactions' })).toBeVisible();
		await expectNoOverflow(page);
	});

	test('reactions toggle optimistically; your own is distinct by more than colour', async ({
		page
	}) => {
		const me = await mkUser('f-me');
		const other = await mkUser('f-other');
		await mkPost(other.id, 'Optimistic reaction post');
		await signIn(page, me);
		await page.goto('/feed');
		const post = article(page, 'Optimistic reaction post');
		const clap = post.getByRole('button', { name: 'Clap, no reactions' });
		await expect(clap).toHaveAttribute('aria-pressed', 'false');
		await expect(clap.locator('svg')).toHaveCount(0);

		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		await page.route('**/api/posts/*/reactions', async (route) => {
			await gate;
			await route.continue();
		});
		await clap.click();
		const pressed = post.getByRole('button', { name: 'Clap, 1 reaction' });
		await expect(pressed).toHaveAttribute('aria-pressed', 'true'); // before the server answered
		await expect(pressed).toBeDisabled();
		await expect(pressed.locator('svg')).toHaveCount(1); // check mark, not colour alone
		const style = await pressed.evaluate((e) => {
			const c = getComputedStyle(e);
			return { bg: c.backgroundColor, h: e.getBoundingClientRect().height, r: c.borderRadius };
		});
		const plain = await post
			.getByRole('button', { name: 'Love, no reactions' })
			.evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(style.bg).not.toBe(plain);
		expect(style.h).toBeGreaterThanOrEqual(44);
		expect(style.r).toBe('6px');
		release();
		await expect(pressed).toBeEnabled();
		await expect(pressed).toHaveAttribute('aria-pressed', 'true');
		await page.reload();
		await expect(
			article(page, 'Optimistic reaction post').getByRole('button', { name: 'Clap, 1 reaction' })
		).toHaveAttribute('aria-pressed', 'true');
	});

	test('a failed reaction request rolls back and says so', async ({ page }) => {
		const me = await mkUser('f-me');
		const other = await mkUser('f-other');
		await mkPost(other.id, 'Rollback post');
		await signIn(page, me);
		await page.goto('/feed');
		await page.route('**/api/posts/*/reactions', (route) =>
			route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
		);
		const post = article(page, 'Rollback post');
		await post.getByRole('button', { name: 'Love, no reactions' }).click();
		await expect(post.getByRole('alert')).toContainText('Could not save your reaction');
		const love = post.getByRole('button', { name: 'Love, no reactions' });
		await expect(love).toHaveAttribute('aria-pressed', 'false');
		await expect(love).toBeEnabled();
	});

	test('comments expand, collapse, add and delete with a two-step confirm', async ({ page }) => {
		const me = await mkUser('f-me');
		const other = await mkUser('f-other');
		const p = await mkPost(other.id, 'Comment thread post');
		await db.insert(schema.comments).values({ postId: p.id, userId: other.id, body: 'First comment here' });
		await signIn(page, me);
		await page.goto('/feed');
		const post = article(page, 'Comment thread post');
		const toggle = post.getByRole('button', { name: /1 comment/ });
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(post.getByText('First comment here')).toHaveCount(0);

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(post.getByText('First comment here')).toBeVisible();

		await post.getByLabel('Add a comment').fill('My own reply');
		await post.getByRole('button', { name: 'Send' }).click();
		await expect(post.getByText('My own reply')).toBeVisible();
		await expect(post.getByRole('button', { name: /2 comments/ })).toBeVisible();

		const mine = post.getByRole('listitem').filter({ hasText: 'My own reply' });
		await mine.getByRole('button', { name: 'Delete' }).click();
		await expect(mine).toContainText('Delete?');
		await mine.getByRole('button', { name: 'No' }).click();
		await expect(post.getByText('My own reply')).toBeVisible();
		await mine.getByRole('button', { name: 'Delete' }).click();
		await mine.getByRole('button', { name: 'Yes' }).click();
		await expect(post.getByText('My own reply')).toHaveCount(0);
		await expect(post.getByRole('button', { name: /1 comment/ })).toBeVisible();
		// Not yours: no delete control.
		await expect(
			post.getByRole('listitem').filter({ hasText: 'First comment here' }).getByRole('button')
		).toHaveCount(0);

		await post.getByRole('button', { name: /1 comment/ }).click();
		await expect(post.getByText('First comment here')).toHaveCount(0);
	});

	test('own posts delete in two steps', async ({ page }) => {
		const me = await mkUser('f-me');
		await mkPost(me.id, 'Post to be removed');
		await signIn(page, me);
		await page.goto('/feed');
		const post = article(page, 'Post to be removed');
		await post.getByRole('button', { name: 'Delete post' }).click();
		await expect(post).toContainText('Delete?');
		await post.getByRole('button', { name: 'No' }).click();
		await expect(post).toBeVisible();
		await post.getByRole('button', { name: 'Delete post' }).click();
		await post.getByRole('button', { name: 'Yes' }).click();
		await expect(article(page, 'Post to be removed')).toHaveCount(0);
	});

	test('compose posts, clears the box and shows the new post', async ({ page }) => {
		const me = await mkUser('f-me');
		await signIn(page, me);
		await page.goto('/feed');
		const box = page.getByLabel('Share something with the kitchen');
		const post = page.getByRole('button', { name: 'Post', exact: true });
		await expect(post).toBeDisabled();
		await box.fill('Hello kitchen');
		await expect(page.getByText('13/500')).toBeVisible();
		await post.click();
		await expect(article(page, 'Hello kitchen')).toBeVisible();
		await expect(box).toHaveValue('');
	});

	test('a post over 500 characters shows an inline error tied to the field', async ({ page }) => {
		const me = await mkUser('f-me');
		await signIn(page, me);
		await page.goto('/feed');
		const box = page.getByLabel('Share something with the kitchen');
		await box.evaluate((e: HTMLTextAreaElement) => e.removeAttribute('maxlength'));
		await box.fill('x'.repeat(501));
		await page.getByRole('button', { name: 'Post', exact: true }).click();
		const alert = page.locator('form').getByRole('alert');
		await expect(alert).toBeVisible();
		const id = await alert.getAttribute('id');
		expect(id).toBeTruthy();
		await expect(box).toHaveAttribute('aria-describedby', new RegExp(id!));
		await expect(box).toHaveAttribute('aria-invalid', 'true');
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('an empty post is rejected inline and the form stays', async ({ page }) => {
			const me = await mkUser('f-me');
			await signIn(page, me);
			await page.goto('/feed');
			await page.getByRole('button', { name: 'Post', exact: true }).click();
			const alert = page.locator('form').getByRole('alert');
			await expect(alert).toBeVisible();
			await expect(page.getByLabel('Share something with the kitchen')).toHaveAttribute(
				'aria-describedby',
				new RegExp((await alert.getAttribute('id'))!)
			);
		});

		test('a plain post works and Load more pages through the feed', async ({ page }) => {
			const me = await mkUser('f-me');
			const base = Date.now() - 3_600_000;
			for (let i = 0; i < 25; i++) {
				await mkPost(me.id, `Bulk post ${String(i).padStart(2, '0')}`, {
					createdAt: new Date(base + i * 1000)
				});
			}
			await signIn(page, me);
			await page.goto('/feed');
			await expect(page.getByRole('article')).toHaveCount(20);
			await expect(article(page, 'Bulk post 24')).toBeVisible();
			await page.getByRole('button', { name: 'Load more' }).click();
			await expect(page).toHaveURL(/before=/);
			await expect(page.getByRole('article')).toHaveCount(5);
			await expect(article(page, 'Bulk post 00')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
			await expect(page.getByRole('link', { name: /Back to newest/ })).toBeVisible();
			await expect(page.getByLabel('Share something with the kitchen')).toHaveCount(0);
		});
	});

	test('a post by a deactivated user is marked as left', async ({ page }) => {
		const me = await mkUser('f-me');
		const gone = await mkUser('f-gone', { active: false });
		await mkPost(gone.id, 'Farewell post');
		await signIn(page, me);
		await page.goto('/feed');
		await expect(article(page, 'Farewell post')).toContainText('(left)');
	});

	test('relative times replace the absolute fallback on mount and keep the exact time in a title', async ({
		page
	}) => {
		const me = await mkUser('f-me');
		await mkPost(me.id, 'Time check post', { createdAt: new Date(Date.now() - 5 * 60_000) });
		await signIn(page, me);
		await page.goto('/feed');
		const time = article(page, 'Time check post').locator('time').first();
		await expect(time).toHaveText('5m ago');
		await expect(time).toHaveAttribute('title', /.+/);
		await expect(time).toHaveAttribute('datetime', /T/);
	});

	test('long unbroken text and names do not overflow at 360px', async ({ page }) => {
		const me = await mkUser('f-me');
		const long = await mkUser('f-long', { displayName: 'Q'.repeat(50) });
		await mkPost(long.id, 'z'.repeat(200));
		await signIn(page, me);
		await page.setViewportSize(SMALL);
		await page.goto('/feed');
		await expect(page.getByRole('article')).toHaveCount(1);
		await expectNoOverflow(page);
	});

	test('laptop layout stays in bounds', async ({ page }) => {
		const me = await mkUser('f-me');
		await mkPost(me.id, 'Laptop post');
		await signIn(page, me);
		await page.setViewportSize(LAPTOP);
		await page.goto('/feed');
		const w = await article(page, 'Laptop post').evaluate((e) => e.getBoundingClientRect().width);
		expect(w).toBeLessThanOrEqual(601);
		await expectNoOverflow(page);
	});

	test.describe('dark mode', () => {
		test.use({ colorScheme: 'dark' });

		test('posts, chips and compose keep WCAG AA contrast', async ({ page }) => {
			const me = await mkUser('f-me');
			const other = await mkUser('f-other');
			const p = await mkPost(other.id, 'Dark mode contrast check');
			await db.insert(schema.reactions).values({ postId: p.id, userId: me.id, emoji: '❤️' });
			await signIn(page, me);
			await page.goto('/feed');
			await expect(page.getByText('Dark mode contrast check')).toBeVisible();
			const post = await lowestContrast(page, 'article');
			expect(post.ratio, `post text "${post.text}"`).toBeGreaterThanOrEqual(4.5);
			const compose = await lowestContrast(page, 'form');
			expect(compose.ratio, `compose text "${compose.text}"`).toBeGreaterThanOrEqual(4.5);
		});
	});
});

// ------------------------------------------------------------------ Visual check (opt-in)

const SHOTS = process.env.COMMUNITY_SHOTS;
test.describe('screenshots', () => {
	test.skip(!SHOTS, 'set COMMUNITY_SHOTS=<dir> to write screenshots');

	for (const scheme of ['light', 'dark'] as const) {
		test(`community pages, ${scheme}`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			const names = ['Lena Hofer', 'Mateo Alvarez', 'Priya Raman', 'Jonas Keller', 'Aiko Tanaka', 'Noah Brunner', 'Sofia Meier', 'Elias Vogel', 'Amara Okafor', 'Tobias Graf'];
			const pts = [52, 52, 47, 41, 41, 33, 28, 24, 19, 12];
			const users = [];
			for (let i = 0; i < names.length; i++) {
				const u = await mkUser(`s${i}`, {
					displayName: names[i],
					classification: i % 3 === 0 ? 'Employee' : 'Student',
					department: i % 3 === 0 ? IRG : undefined
				});
				await award(u.id, pts[i]);
				users.push(u);
			}
			const me = users[2];
			const file = await writeProof();
			const now = Date.now();
			const p1 = await mkPost(users[0].id, 'Lena just did: Descale the coffee machine! 🎉', {
				milestone: true,
				imagePath: file,
				createdAt: new Date(now - 18 * 60_000)
			});
			await mkPost(users[1].id, 'New bag of beans is in the left cupboard: Ethiopian, medium roast. Please grind only what you need.', {
				createdAt: new Date(now - 2 * 3_600_000)
			});
			await db.insert(schema.comments).values({ postId: p1.id, userId: users[1].id, body: 'Finally, thank you!' });
			await db.insert(schema.reactions).values({ postId: p1.id, userId: me.id, emoji: '❤️' });
			const [old] = await db
				.insert(schema.periods)
				.values({ name: 'Spring semester 2026', startsAt: new Date('2026-02-01'), endsAt: new Date('2026-07-31'), status: 'ended' })
				.returning();
			periodIds.push(old.id);
			await db.insert(schema.submissions).values({ userId: users[0].id, taskKey: 'milk', periodId: old.id, status: 'approved', pointsAwarded: 60 });
			await db.insert(schema.periodWinners).values([
				{ periodId: old.id, userId: users[0].id, points: 60, rank: 1 },
				{ periodId: old.id, userId: users[1].id, points: 60, rank: 1 }
			]);
			await signIn(page, me);
			await mkdir(SHOTS!, { recursive: true });
			const sizes = [
				['phone', PHONE],
				['laptop', LAPTOP]
			] as const;
			for (const [label, size] of sizes) {
				await page.setViewportSize(size);
				for (const path of ['leaderboard', 'history', 'feed']) {
					if (label === 'laptop' && path === 'history') continue;
					await page.goto(`/${path}`);
					await page.waitForLoadState('networkidle');
					if (path === 'feed') {
						await article(page, 'Descale').getByRole('button', { name: /comment/ }).click();
					}
					await page.screenshot({ path: join(SHOTS!, `${path}-${scheme}-${label}.png`), fullPage: label === 'phone' });
				}
			}
		});
	}
});
