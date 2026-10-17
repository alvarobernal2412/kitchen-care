import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema';
import { E2E_UPLOAD_DIR } from './env';
import { createUser, db, getUser, giveSession } from './helpers';

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };

const TASK_ORDER = ['cutlery', 'dishwasher', 'grounds', 'milk', 'beans', 'descale', 'deep_clean'];

async function activePeriodId(): Promise<number> {
	const [p] = await db.select().from(schema.periods).where(eq(schema.periods.status, 'active'));
	return p.id;
}

type Seed = {
	task: string;
	status?: 'pending' | 'approved' | 'rejected' | 'revoked';
	points?: number;
	ageSeconds?: number;
	revokeReason?: string;
};

/** Inserts submissions straight into the e2e database for a user. */
// Everything a test creates is removed afterwards (the e2e database is shared by every spec), so
// seeded points never leak into other tests' ranks and pending rows never reach the admin badge.
const createdUsers: number[] = [];
const createdPeriods: number[] = [];
const createdPosts: number[] = [];

test.afterEach(async () => {
	const ids = createdUsers.splice(0);
	for (const id of ids) {
		await db.delete(schema.periodWinners).where(eq(schema.periodWinners.userId, id));
		await db.delete(schema.posts).where(eq(schema.posts.userId, id));
		await db.delete(schema.submissions).where(eq(schema.submissions.userId, id));
	}
	for (const id of createdPeriods.splice(0)) {
		await db.delete(schema.periodWinners).where(eq(schema.periodWinners.periodId, id));
		await db.delete(schema.periods).where(eq(schema.periods.id, id));
	}
	createdPosts.length = 0;
});

async function seed(username: string, rows: Seed[]) {
	const user = await getUser(username);
	const periodId = await activePeriodId();
	for (const r of rows) {
		const status = r.status ?? 'approved';
		await db.insert(schema.submissions).values({
			userId: user.id,
			taskKey: r.task,
			periodId,
			status,
			pointsAwarded: status === 'approved' || status === 'revoked' ? (r.points ?? 1) : 0,
			revokeReason: r.revokeReason ?? null,
			createdAt: new Date(Date.now() - (r.ageSeconds ?? 0) * 1000)
		});
	}
}

async function signedIn(page: Page, username?: string) {
	const creds = await createUser(username);
	createdUsers.push((await getUser(creds.username)).id);
	await giveSession(page.context(), creds.username, creds.password);
	return creds.username;
}

/** Opens Home and waits until the page is hydrated (taps before that do nothing). */
async function openHome(page: Page) {
	await page.goto('/');
	await expect(page.locator('.tiles[data-ready]')).toBeAttached();
}

const tile = (page: Page, key: string) => page.locator(`.chore[data-task="${key}"]`);
const total = (page: Page) => page.getByTestId('credit-total');

async function box(page: Page, key: string) {
	const b = await tile(page, key).boundingBox();
	if (!b) throw new Error(`tile ${key} has no box`);
	return b;
}

/** Tile boxes relative to the grid, so header height changes do not count as tile shifts. */
async function tileBoxes(page: Page) {
	const grid = (await page.locator('.tiles').boundingBox())!;
	const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
	for (const key of TASK_ORDER) {
		const b = await box(page, key);
		out[key] = { x: b.x - grid.x, y: b.y - grid.y, width: b.width, height: b.height };
	}
	return out;
}

async function noHorizontalOverflow(page: Page) {
	const result = await page.evaluate(() => {
		const root = document.documentElement;
		const vw = root.clientWidth;
		const wide = [...document.querySelectorAll('body *')]
			.filter((el) => {
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.right <= vw + 0.5 || getComputedStyle(el).position === 'fixed') return false;
				// content clipped by an ancestor (text-overflow: ellipsis) is not visible overflow
				for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
					if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= vw + 0.5) return false;
				}
				return true;
			})
			.map((el) => el.tagName + '.' + el.className);
		return { scroll: root.scrollWidth, client: vw, wide };
	});
	expect(result.scroll).toBeLessThanOrEqual(result.client);
	expect(result.wide).toEqual([]);
}

const longName = () => 'W'.repeat(24) + Math.random().toString(36).slice(2, 8);

/** Only the name gives way (ellipsis); "logged ..." and the time must remain fully visible. */
async function expectLongNameTruncated(page: Page) {
	const username = await signedIn(page, longName());
	await seed(username, [{ task: 'dishwasher', points: 2 }]);
	await openHome(page);
	const li = page.locator('.recent li').first();
	await expect(li.locator('.act')).toHaveText('logged dishwasher');
	const m = await li.evaluate((el) => {
		const q = (sel: string) => el.querySelector(sel) as HTMLElement;
		const user = q('.user');
		const li = el.getBoundingClientRect();
		const within = (e: HTMLElement) => {
			const r = e.getBoundingClientRect();
			return r.left >= li.left - 0.5 && r.right <= li.right + 0.5;
		};
		return {
			ellipsis: getComputedStyle(user).textOverflow,
			clipped: user.scrollWidth > user.clientWidth,
			actClipped: q('.act').scrollWidth > q('.act').clientWidth,
			actVisible: within(q('.act')),
			timeVisible: within(q('time'))
		};
	});
	expect(m).toEqual({
		ellipsis: 'ellipsis',
		clipped: true,
		actClipped: false,
		actVisible: true,
		timeVisible: true
	});
	await noHorizontalOverflow(page);
}

test.describe('home on a phone', () => {
	test.use({ viewport: PHONE });

	test('shows credits, rank and the four tile states in order', async ({ page }) => {
		const username = await signedIn(page);
		// dishwasher logged halfway through its 150 minute cooldown, a beans photo waiting for review
		await seed(username, [
			{ task: 'dishwasher', points: 2, ageSeconds: 4500 },
			{ task: 'beans', status: 'pending' }
		]);
		await openHome(page);

		await expect(total(page)).toHaveText('2');
		await expect(page.getByTestId('rank')).toHaveText(/^\d+(st|nd|rd|th) of \d+$/);
		await expect(page.getByTestId('status')).toContainText(/credits? behind first place|first place/);
		await expect(page.getByTestId('status')).toContainText('Cutlery is ready to log.');

		const states = await page.locator('.chore').evaluateAll((els) =>
			els.map((el) => [(el as HTMLElement).dataset.task, (el as HTMLElement).dataset.state])
		);
		expect(states).toEqual([
			['cutlery', 'ready'],
			['dishwasher', 'cooldown'],
			['grounds', 'photo'],
			['milk', 'photo'],
			['beans', 'pending'],
			['descale', 'photo'],
			['deep_clean', 'photo']
		]);

		await expect(tile(page, 'grounds')).toContainText('Photo + review');
		await expect(tile(page, 'cutlery')).toContainText('Photo check');
		await expect(tile(page, 'milk')).toContainText('Photo + review');
		await expect(tile(page, 'beans')).toContainText('Waiting for review');
		await expect(tile(page, 'dishwasher')).toContainText(/Ready in \d+ (min|h)/);
		const dish = page.getByRole('button', { name: /^\+2 Empty or run dishwasher Ready in/ });
		await expect(dish).toHaveAttribute('aria-disabled', 'true');
		await expect(page.getByRole('button', { name: /^\+3 Take coffee grounds.* Photo \+ review/ })).toBeEnabled();
	});

	test('cooldown fill reflects the elapsed share of the cooldown', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [{ task: 'dishwasher', points: 2, ageSeconds: 4500 }]); // 4500 of 9000 s
		await openHome(page);
		await expect
			.poll(async () =>
				parseFloat(await tile(page, 'dishwasher').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--fill')))
			)
			.toBeGreaterThan(47);
		const fill = parseFloat(
			await tile(page, 'dishwasher').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--fill'))
		);
		expect(fill).toBeLessThan(53);
		// and the fill is really drawn: the pseudo-element covers about half of the tile
		const h = await tile(page, 'dishwasher').evaluate(
			(el) => parseFloat(getComputedStyle(el, '::before').height) / el.clientHeight
		);
		expect(h).toBeGreaterThan(0.45);
		expect(h).toBeLessThan(0.55);
	});

	test('grid is two columns, tiles are large, the +15 tile spans the row', async ({ page }) => {
		await signedIn(page);
		await openHome(page);
		const b = await tileBoxes(page);
		expect(b.dishwasher.x).toBeGreaterThan(b.cutlery.x + 100);
		expect(b.grounds.x).toBeCloseTo(b.cutlery.x, 0);
		expect(b.milk.x).toBeCloseTo(b.dishwasher.x, 0);
		expect(b.beans.x).toBeCloseTo(b.cutlery.x, 0);
		expect(b.descale.x).toBeCloseTo(b.dishwasher.x, 0);
		const grid = (await page.locator('.tiles').boundingBox())!;
		expect(b.deep_clean.width).toBeCloseTo(grid.width, 0);
		for (const key of TASK_ORDER) {
			expect(b[key].height).toBeGreaterThanOrEqual(96);
			expect(b[key].width).toBeGreaterThanOrEqual(44);
		}
		await noHorizontalOverflow(page);
	});

	test('tapping a ready tile logs the chore, updates the total exactly and keeps the grid still', async ({
		page
	}) => {
		const username = await signedIn(page);
		await openHome(page);
		await expect(total(page)).toHaveText('0');
		const before = await tileBoxes(page);

		await tile(page, 'dishwasher').click();

		await expect(total(page)).toHaveText('2');
		await expect(tile(page, 'dishwasher')).toHaveAttribute('data-state', 'cooldown');
		await expect(tile(page, 'dishwasher')).toContainText(/Ready in/);
		await expect(page.getByTestId('status')).not.toContainText('Log your first chore');
		await expect(page.getByTestId('rank')).toHaveText(/^\d+(st|nd|rd|th) of \d+$/);
		// the activity feed refreshes too
		const latest = page.locator('.recent li').first();
		await expect(latest.locator('.user')).toHaveText(username);
		await expect(latest.locator('.act')).toHaveText('logged dishwasher');
		expect(await tileBoxes(page)).toEqual(before);

		const [row] = await db
			.select()
			.from(schema.submissions)
			.where(eq(schema.submissions.userId, (await getUser(username)).id));
		expect(row).toMatchObject({ taskKey: 'dishwasher', status: 'approved', pointsAwarded: 2 });
	});

	test('a log updates the total to the server value and survives a reload', async ({ page }) => {
		const username = await signedIn(page);
		await openHome(page);
		const responses: number[] = [];
		page.on('response', async (r) => {
			if (/\/api\/tasks\//.test(r.url()) && r.ok()) responses.push((await r.json()).newTotal);
		});
		await tile(page, 'dishwasher').click();
		await expect.poll(() => responses).toEqual([2]);
		await expect(total(page)).toHaveText('2');
		await expect(tile(page, 'dishwasher')).toHaveAttribute('data-state', 'cooldown');
		// a second tap on the cooling tile is ignored
		await tile(page, 'dishwasher').click({ force: true });
		await expect(page.getByTestId('fly')).toHaveCount(0);
		// the refreshed server data agrees (still 2 after a reload)
		await page.reload();
		await expect(total(page)).toHaveText('2');
		const rows = await db
			.select()
			.from(schema.submissions)
			.where(eq(schema.submissions.userId, (await getUser(username)).id));
		expect(rows).toHaveLength(1);
	});

	test('the +N flies to the total when motion is allowed', async ({ page }) => {
		await signedIn(page);
		await page.addInitScript(() => {
			(window as unknown as { __fly: number }).__fly = 0;
			new MutationObserver((records) => {
				for (const r of records)
					for (const n of r.addedNodes)
						if (n instanceof HTMLElement && n.dataset.testid === 'fly')
							(window as unknown as { __fly: number }).__fly++;
			}).observe(document, { childList: true, subtree: true });
		});
		await openHome(page);
		await tile(page, 'dishwasher').click();
		await expect.poll(() => page.evaluate(() => (window as unknown as { __fly: number }).__fly)).toBe(1);
		await expect(total(page)).toHaveText('2');
		await expect(page.getByTestId('fly')).toHaveCount(0);
	});

	test('a failed log shows an inline message, never a dialog', async ({ page }) => {
		await signedIn(page);
		page.on('dialog', () => {
			throw new Error('unexpected dialog');
		});
		await page.route('**/api/tasks/dishwasher', (route) =>
			route.fulfill({ status: 429, json: { error: 'rate_limited' } })
		);
		await openHome(page);
		await tile(page, 'dishwasher').click();
		await expect(page.getByTestId('message')).toContainText('Too many tries');
		await expect(total(page)).toHaveText('0');
		await expect(tile(page, 'dishwasher')).toHaveAttribute('data-state', 'ready');
	});

	test('a user with no points is invited to log a first chore', async ({ page }) => {
		await signedIn(page);
		await openHome(page);
		await expect(page.getByTestId('status')).toContainText('Log your first chore to join the board.');
		await expect(page.getByText('Not ranked')).toBeVisible();
		await expect(total(page)).toHaveText('0');
	});

	test('a four-digit total fits at 360 px', async ({ page }) => {
		await page.setViewportSize(SMALL);
		const username = await signedIn(page);
		await seed(username, [{ task: 'beans', points: 9999 }]);
		await openHome(page);
		await expect(total(page)).toHaveText('9999');
		await noHorizontalOverflow(page);
	});

	test('a very long username truncates but the action and time stay visible', async ({ page }) => {
		await expectLongNameTruncated(page);
	});

	test('a period without activity shows the friendly empty state', async ({ page }) => {
		await signedIn(page);
		const oldId = await activePeriodId();
		await db.update(schema.periods).set({ status: 'ended', endsAt: new Date() }).where(eq(schema.periods.id, oldId));
		const [fresh] = await db
			.insert(schema.periods)
			.values({ name: 'Fresh period', startsAt: new Date(), status: 'active' })
			.returning();
		createdPeriods.push(fresh.id);
		try {
			await openHome(page);
			await expect(page.getByText('Fresh period')).toBeVisible();
			await expect(page.getByText('Nothing logged yet this period. Be the first.')).toBeVisible();
			await expect(page.getByTestId('status')).toContainText('Log your first chore to join the board.');
		} finally {
			await db
				.update(schema.periods)
				.set({ status: 'ended', endsAt: new Date() })
				.where(eq(schema.periods.id, fresh.id));
			await db.update(schema.periods).set({ status: 'active', endsAt: null }).where(eq(schema.periods.id, oldId));
		}
	});

	test('with no active period the tiles are gone and the page explains what to do', async ({
		page
	}) => {
		await signedIn(page);
		const periodId = await activePeriodId();
		await db.update(schema.periods).set({ status: 'ended', endsAt: new Date() }).where(eq(schema.periods.id, periodId));
		try {
			await page.goto('/');
			await expect(page.getByRole('heading', { name: 'No active period yet' })).toBeVisible();
			await expect(page.getByText('No period is running. An admin starts the next one.')).toBeVisible();
			await expect(page.locator('.chore')).toHaveCount(0);
			await noHorizontalOverflow(page);
		} finally {
			await db
				.update(schema.periods)
				.set({ status: 'active', endsAt: null })
				.where(eq(schema.periods.id, periodId));
		}
	});
});

test.describe('home with reduced motion', () => {
	test.use({ viewport: PHONE, reducedMotion: 'reduce' });

	test('no flying credit is ever added but the total still updates', async ({ page }) => {
		await signedIn(page);
		await page.addInitScript(() => {
			(window as unknown as { __fly: number }).__fly = 0;
			new MutationObserver((records) => {
				for (const r of records)
					for (const n of r.addedNodes)
						if (n instanceof HTMLElement && (n.dataset.testid === 'fly' || n.querySelector?.('[data-testid="fly"]')))
							(window as unknown as { __fly: number }).__fly++;
			}).observe(document, { childList: true, subtree: true });
		});
		await openHome(page);
		await tile(page, 'dishwasher').click();
		await expect(total(page)).toHaveText('2');
		await expect(tile(page, 'dishwasher')).toHaveAttribute('data-state', 'cooldown');
		expect(await page.evaluate(() => (window as unknown as { __fly: number }).__fly)).toBe(0);
	});
});

test.describe('coffee grounds is a reviewed photo chore', () => {
	test.use({ viewport: PHONE });

	test('is not tappable while its latest photo waits for review', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [{ task: 'grounds', status: 'pending', ageSeconds: 3600 }]);
		await openHome(page);
		const grounds = tile(page, 'grounds');
		await expect(grounds).toHaveAttribute('data-state', 'pending');
		await expect(grounds).toContainText('Waiting for review');
		await expect(grounds).toHaveAttribute('aria-disabled', 'true');
		await expect(
			page.getByRole('button', { name: /^\+3 Take coffee grounds.* Waiting for review, 1 waiting$/ })
		).toBeVisible();
		await grounds.click({ force: true });
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('counts down after an approved log and fills like the dishwasher', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [{ task: 'grounds', points: 3, ageSeconds: 3600 }]);
		await openHome(page);
		const grounds = tile(page, 'grounds');
		await expect(grounds).toHaveAttribute('data-state', 'cooldown');
		await expect(grounds).toContainText(/Ready in 2[23] h \d+ min/);
		await expect(grounds).toHaveAttribute('aria-disabled', 'true');
		const fill = parseFloat(await grounds.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--fill')));
		expect(fill).toBeGreaterThan(3);
		expect(fill).toBeLessThan(6);
		await expect(total(page)).toHaveText('3');
	});

	test('is available again after a rejection or a removal', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [
			{ task: 'grounds', status: 'rejected', ageSeconds: 60 },
			{ task: 'grounds', status: 'revoked', points: 3, ageSeconds: 30, revokeReason: 'wrong bin' }
		]);
		await openHome(page);
		await expect(tile(page, 'grounds')).toHaveAttribute('data-state', 'photo');
		await expect(tile(page, 'grounds')).not.toHaveAttribute('aria-disabled', 'true');
		await expect(total(page)).toHaveText('0');
	});

	test('a removed chore shows who removed it and why, and scores nothing', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [
			{ task: 'dishwasher', status: 'revoked', points: 2, ageSeconds: 120, revokeReason: 'it was already empty' },
			{ task: 'dishwasher', points: 2, ageSeconds: 20000 }
		]);
		await openHome(page);
		await expect(total(page)).toHaveText('2');
		const mine = page.locator('.mine li').first();
		await expect(mine).toContainText('Empty or run dishwasher');
		await expect(mine).toContainText('Removed');
		await expect(mine).toContainText('Removed by admin: it was already empty');
		await expect(mine).not.toContainText('+2');
		await expect(tile(page, 'dishwasher')).toHaveAttribute('data-state', 'ready');
		await noHorizontalOverflow(page);
	});
});

test.describe('avatars in recent activity', () => {
	test.use({ viewport: PHONE });

	test('an uploaded avatar shows as an image, a missing one as initials', async ({ page }) => {
		const withAvatar = await signedIn(page);
		const name = `${'a'.repeat(32 - 8)}${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
		await mkdir(E2E_UPLOAD_DIR, { recursive: true });
		const file = `${name}.webp`;
		await writeFile(
			join(E2E_UPLOAD_DIR, file),
			await sharp({ create: { width: 64, height: 64, channels: 3, background: '#2a6' } }).webp().toBuffer()
		);
		await db.update(schema.users).set({ avatarPath: file }).where(eq(schema.users.id, (await getUser(withAvatar)).id));
		const plain = 'plain' + Math.random().toString(36).slice(2, 7);
		const plainCreds = await createUser(plain);
		createdUsers.push((await getUser(plainCreds.username)).id);
		await seed(withAvatar, [{ task: 'dishwasher', points: 2, ageSeconds: 100 }]);
		await seed(plain, [{ task: 'dishwasher', points: 2, ageSeconds: 50 }]);
		await openHome(page);

		const rowOf = (u: string) => page.locator('.recent li').filter({ has: page.locator('.user', { hasText: u }) });
		const img = rowOf(withAvatar).locator('img');
		await expect(img).toHaveAttribute('src', `/media/${file}`);
		await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
		await expect(rowOf(plain).locator('img')).toHaveCount(0);
		await expect(rowOf(plain)).toContainText(plain.slice(0, 1).toUpperCase());
	});
});

test.describe('home on a laptop', () => {
	test.use({ viewport: LAPTOP });

	test('uses three columns with recent activity beside the tiles', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [{ task: 'milk', points: 3 }]);
		await openHome(page);
		const b = await tileBoxes(page);
		expect(b.dishwasher.x).toBeGreaterThan(b.cutlery.x + 100);
		expect(b.grounds.x).toBeGreaterThan(b.dishwasher.x + 100);
		expect(b.milk.x).toBeCloseTo(b.cutlery.x, 0);
		expect(b.beans.x).toBeCloseTo(b.dishwasher.x, 0);
		expect(b.descale.x).toBeCloseTo(b.grounds.x, 0);
		const grid = (await page.locator('.tiles').boundingBox())!;
		expect(b.deep_clean.width).toBeCloseTo(grid.width, 0);

		const gridRight = grid.x + grid.width;
		const recent = (await page.locator('.recent').boundingBox())!;
		expect(recent.x).toBeGreaterThanOrEqual(gridRight);
		const hLog = (await page.getByRole('heading', { name: 'Log a chore' }).boundingBox())!;
		const hRec = (await page.getByRole('heading', { name: 'Recent in the kitchen' }).boundingBox())!;
		expect(Math.abs(hLog.y - hRec.y)).toBeLessThan(4);
		await noHorizontalOverflow(page);
	});
});

test.describe('home recent activity in the 280 px desktop column', () => {
	test.use({ viewport: LAPTOP });
	test('a very long username truncates but the action and time stay visible', async ({ page }) => {
		await expectLongNameTruncated(page);
	});
});

test.describe('home in dark mode', () => {
	test.use({ viewport: PHONE, colorScheme: 'dark' });

	test('tiles use the dark tokens', async ({ page }) => {
		const username = await signedIn(page);
		await seed(username, [{ task: 'dishwasher', points: 2, ageSeconds: 4500 }]);
		await openHome(page);
		const resolve = (token: string) =>
			page.evaluate((t) => {
				const probe = document.createElement('div');
				probe.style.backgroundColor = `var(${t})`;
				document.body.append(probe);
				const c = getComputedStyle(probe).backgroundColor;
				probe.remove();
				return c;
			}, token);
		expect(await resolve('--accent-wash')).toBe('rgb(31, 58, 51)');
		await expect(tile(page, 'cutlery')).toHaveCSS('background-color', 'rgb(31, 58, 51)');
		await expect(tile(page, 'milk')).toHaveCSS('background-color', await resolve('--surface'));
		await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 22, 19)');
	});
});
