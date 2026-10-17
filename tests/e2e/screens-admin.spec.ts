import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '../../src/lib/server/db/schema';
import { E2E_ORIGIN, E2E_UPLOAD_DIR } from './env';
import { createUser, db, getUser, giveSession, loginAsAdmin, lowestContrast, uniqueUsername } from './helpers';

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };

// A fake camera device for the overlay tests (launch options cannot be set per describe block).
test.use({
	viewport: PHONE,
	launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

const userIds: number[] = [];
const periodIds: number[] = [];
let restorePeriod: number | null = null;

async function activePeriodId(): Promise<number> {
	const [p] = await db.select().from(schema.periods).where(eq(schema.periods.status, 'active'));
	return p.id;
}

// The e2e database is shared: start every test without pending rows, posts or events of other specs.
test.beforeEach(async () => {
	await db.delete(schema.posts);
	await db.delete(schema.submissions).where(eq(schema.submissions.status, 'pending'));
});

test.afterEach(async () => {
	await db.delete(schema.posts);
	const ids = userIds.splice(0);
	if (ids.length) {
		await db.delete(schema.periodWinners).where(inArray(schema.periodWinners.userId, ids));
		await db.delete(schema.submissions).where(inArray(schema.submissions.userId, ids));
		await db.delete(schema.events).where(inArray(schema.events.userId, ids));
		// reset links generated for these users
		await db.delete(schema.resetTokens).where(inArray(schema.resetTokens.userId, ids));
	}
	for (const id of periodIds.splice(0)) {
		await db.delete(schema.periodWinners).where(eq(schema.periodWinners.periodId, id));
		await db.delete(schema.submissions).where(eq(schema.submissions.periodId, id));
		await db.delete(schema.periods).where(eq(schema.periods.id, id));
	}
	if (restorePeriod !== null) {
		await db.update(schema.periods).set({ status: 'active', endsAt: null }).where(eq(schema.periods.id, restorePeriod));
		restorePeriod = null;
	}
});

async function mkUser(prefix: string, opts: { admin?: boolean; active?: boolean; classification?: 'Student' | 'Employee' } = {}) {
	const creds = await createUser(uniqueUsername(prefix));
	const [row] = await db
		.update(schema.users)
		.set({
			classification: opts.classification ?? 'Student',
			active: opts.active ?? true,
			...(opts.admin ? { role: 'admin' as const } : {})
		})
		.where(eq(schema.users.usernameNormalized, creds.username.toLowerCase()))
		.returning();
	userIds.push(row.id);
	return { ...creds, id: row.id };
}

/** Writes a real WebP proof photo into the upload directory; returns its stored file name. */
async function writeProof(): Promise<string> {
	const file = `${randomBytes(16).toString('hex')}.webp`;
	await mkdir(E2E_UPLOAD_DIR, { recursive: true });
	const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#7a8f86' } })
		.webp()
		.toBuffer();
	await writeFile(join(E2E_UPLOAD_DIR, file), buf);
	return file;
}

async function sub(
	userId: number,
	taskKey: string,
	extra: {
		status?: 'pending' | 'approved' | 'rejected';
		periodId?: number;
		image?: boolean | string;
		ageMinutes?: number;
		points?: number;
	} = {}
) {
	const status = extra.status ?? 'pending';
	const imagePath =
		typeof extra.image === 'string' ? extra.image : extra.image === false ? null : await writeProof();
	const [row] = await db
		.insert(schema.submissions)
		.values({
			userId,
			taskKey,
			periodId: extra.periodId ?? (await activePeriodId()),
			status,
			pointsAwarded: status === 'approved' ? (extra.points ?? 3) : 0,
			imagePath,
			createdAt: new Date(Date.now() - (extra.ageMinutes ?? 5) * 60_000)
		})
		.returning();
	return row;
}

async function mkEndedPeriod(name: string) {
	const [p] = await db
		.insert(schema.periods)
		.values({
			name,
			startsAt: new Date(Date.now() - 20 * 86_400_000),
			endsAt: new Date(Date.now() - 10 * 86_400_000),
			status: 'ended'
		})
		.returning();
	periodIds.push(p.id);
	return p;
}

/** Ends the seeded active period so a test can run without one; it is restored afterwards. */
async function withoutActivePeriod() {
	restorePeriod = await activePeriodId();
	await db
		.update(schema.periods)
		.set({ status: 'ended', endsAt: new Date() })
		.where(eq(schema.periods.id, restorePeriod));
}

/** True when the page scrolls sideways or an element sticks out of the viewport outside a scroller. */
async function overflow(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const out: string[] = [];
		if (document.documentElement.scrollWidth > innerWidth) {
			out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${innerWidth}`);
		}
		const inScroller = (el: Element) => {
			for (let p = el.parentElement; p; p = p.parentElement) {
				const o = getComputedStyle(p).overflowX;
				if (o === 'auto' || o === 'scroll') return true;
			}
			return false;
		};
		for (const el of document.querySelectorAll('main *')) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.right > innerWidth + 1 && !inScroller(el)) {
				out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} right ${Math.round(r.right)}`);
			}
		}
		return out;
	});
}

async function height(l: Locator): Promise<number> {
	return (await l.boundingBox())!.height;
}

/** WCAG contrast of an element's computed fill against the colour it is drawn on. */
async function markContrast(page: Page, selector: string, groundSelector = 'body'): Promise<number> {
	return page.evaluate(
		([sel, ground]) => {
			const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
			const lum = (c: number[]) => {
				const [r, g, b] = c.slice(0, 3).map((v) => {
					const x = v / 255;
					return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
				});
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const fill = parse(getComputedStyle(document.querySelector(sel)!).backgroundColor);
			const bg = parse(getComputedStyle(document.querySelector(ground)!).backgroundColor);
			const a = lum(fill);
			const b = lum(bg);
			return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
		},
		[selector, groundSelector]
	);
}

// ---------------------------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------------------------
test.describe('review queue', () => {
	const row = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });

	test('rows show the proof, who, the credits and the review controls', async ({ page }) => {
		const u = await mkUser('rv');
		await sub(u.id, 'milk');
		await sub(u.id, 'beans', { ageMinutes: 30 });
		await loginAsAdmin(page);
		await page.goto('/admin/review');

		await expect(page.getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible();
		await expect(page.getByText('2 submissions are waiting. Credits are added to the total when you approve.')).toBeVisible();
		const r = row(page, 'Bring milk');
		await expect(r.getByRole('heading', { level: 2, name: 'Bring milk' })).toBeVisible();
		await expect(r.getByText(u.username, { exact: true })).toBeVisible();
		await expect(r.getByText(/^\+\d+ credits? on approval$/)).toBeVisible();
		await expect(r.getByLabel('Reason, if you reject')).toBeVisible();
		await expect(r.getByRole('button', { name: 'Reject' })).toBeVisible();
		await expect(r.getByRole('button', { name: 'Approve' })).toBeVisible();

		// the proof is a loaded image that links to the full file
		const img = r.getByRole('img', { name: 'Proof for Bring milk' });
		await expect(img).toBeVisible();
		await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
		await expect(r.getByRole('link', { name: 'Proof for Bring milk' })).toHaveAttribute('href', /^\/media\/[0-9a-f]{32}\.webp$/);
		await expect(r.getByRole('link', { name: 'Proof for Bring milk' })).toHaveAttribute('target', '_blank');

		// 44 px targets on a phone, no horizontal overflow
		for (const l of [r.getByRole('button', { name: 'Reject' }), r.getByRole('button', { name: 'Approve' }), r.getByLabel('Reason, if you reject')]) {
			expect(await height(l)).toBeGreaterThanOrEqual(44);
		}
		expect(await overflow(page)).toEqual([]);

		// phone: the image is full width and the actions sit below the details
		const imgBox = (await img.boundingBox())!;
		expect(imgBox.width).toBeGreaterThan(PHONE.width - 80);
		const h2 = (await r.getByRole('heading', { level: 2 }).boundingBox())!;
		const approve = (await r.getByRole('button', { name: 'Approve' }).boundingBox())!;
		expect(approve.y).toBeGreaterThan(h2.y);
	});

	test('on a laptop the row is image, details, actions side by side', async ({ page }) => {
		await page.setViewportSize(LAPTOP);
		const u = await mkUser('rv');
		await sub(u.id, 'milk');
		await loginAsAdmin(page);
		await page.goto('/admin/review');
		const r = row(page, 'Bring milk');
		const img = (await r.getByRole('img', { name: 'Proof for Bring milk' }).boundingBox())!;
		const h2 = (await r.getByRole('heading', { level: 2 }).boundingBox())!;
		const sel = (await r.getByLabel('Reason, if you reject').boundingBox())!;
		expect(img.x + img.width).toBeLessThanOrEqual(h2.x);
		expect(h2.x + 40).toBeLessThan(sel.x);
		// 4:3 frame
		expect(img.width / img.height).toBeCloseTo(4 / 3, 1);
		expect(await overflow(page)).toEqual([]);
	});

	test('approve credits the user', async ({ page }) => {
		const u = await mkUser('rv');
		const s = await sub(u.id, 'milk');
		await loginAsAdmin(page);
		await page.goto('/admin/review');
		await row(page, 'Bring milk').getByRole('button', { name: 'Approve' }).click();
		await expect(page.getByText('Nothing to review. New photos show up here.')).toBeVisible();
		const [after] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id));
		expect(after.status).toBe('approved');
		expect(after.pointsAwarded).toBeGreaterThan(0);
		await page.goto('/leaderboard');
		await expect(page.getByRole('listitem').filter({ hasText: u.username })).toBeVisible();
	});

	test('reject needs a reason and records it', async ({ page }) => {
		const u = await mkUser('rv');
		const s = await sub(u.id, 'beans');
		await loginAsAdmin(page);
		await page.goto('/admin/review');
		const r = row(page, 'Bring coffee beans');
		await r.getByRole('button', { name: 'Reject' }).click();
		await expect(r.getByRole('alert')).toHaveText('Pick a reason');
		await r.getByLabel('Reason, if you reject').selectOption('Photo unclear');
		await r.getByLabel('Note (optional)').fill('too dark');
		await r.getByRole('button', { name: 'Reject' }).click();
		await expect(r).toHaveCount(0);
		const [after] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, s.id));
		expect(after.status).toBe('rejected');
		expect(after.rejectReason).toBe('Photo unclear: too dark');
	});

	test('typed errors are readable inline: period closed, already reviewed', async ({ page }) => {
		const u = await mkUser('rv');
		const ended = await mkEndedPeriod('Old period');
		await sub(u.id, 'descale', { periodId: ended.id });
		const racing = await sub(u.id, 'milk');
		await loginAsAdmin(page);
		await page.goto('/admin/review');

		const closed = row(page, 'Descale coffee machine');
		await closed.getByRole('button', { name: 'Approve' }).click();
		await expect(closed.getByRole('alert')).toHaveText('Its period has ended, so it cannot be approved. Reject it instead.');

		await db
			.update(schema.submissions)
			.set({ status: 'approved', pointsAwarded: 3 })
			.where(eq(schema.submissions.id, racing.id));
		const taken = row(page, 'Bring milk');
		await taken.getByRole('button', { name: 'Approve' }).click();
		await expect(taken.getByRole('alert')).toHaveText('This submission was already reviewed.');
		expect(await overflow(page)).toEqual([]);
	});

	test('empty state', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/review');
		await expect(page.getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible();
		await expect(page.getByText('Nothing to review. New photos show up here.')).toBeVisible();
	});

	test.describe('dark', () => {
		test.use({ colorScheme: 'dark' });
		test('stays readable in dark mode', async ({ page }) => {
			const u = await mkUser('rv');
			await sub(u.id, 'milk');
			await loginAsAdmin(page);
			await page.goto('/admin/review');
			await expect(page.getByRole('listitem').filter({ hasText: 'Bring milk' })).toBeVisible();
			const r = await lowestContrast(page, 'main');
			expect(r.ratio, `review text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
			expect(await overflow(page)).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------
test.describe('users', () => {
	test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
	const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

	test('search narrows the list; rows show state as text', async ({ page }) => {
		const a = await mkUser('srchfind');
		const b = await mkUser('srchother', { admin: true });
		const c = await mkUser('srchgone', { active: false });
		await loginAsAdmin(page);
		await page.goto('/admin/users?q=srch');
		await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
		await expect(row(page, c.username).getByText('Deactivated')).toBeVisible();
		await expect(row(page, b.username).getByText('Admin', { exact: true })).toBeVisible();

		await page.getByLabel('Search by username').fill(a.username);
		await page.getByRole('button', { name: 'Search' }).click();
		await expect(page).toHaveURL(/q=srchfind/);
		await expect(row(page, a.username)).toBeVisible();
		await expect(row(page, b.username)).toHaveCount(0);

		await page.getByLabel('Search by username').fill('zzzz-nobody-zzzz');
		await page.getByRole('button', { name: 'Search' }).click();
		await expect(page.getByText('No users match.')).toBeVisible();
		expect(await overflow(page)).toEqual([]);
	});

	test('role and active changes need the confirmation step', async ({ page }) => {
		const u = await mkUser('act');
		await loginAsAdmin(page);
		await page.goto(`/admin/users?q=${u.username}`);
		const r = row(page, u.username);
		await r.getByText('Actions').click();

		// make admin: blocked until the box is ticked
		const make = r.getByRole('button', { name: 'Make admin' });
		await make.click();
		expect((await getUser(u.username)).role).toBe('user');
		await r.getByLabel(`Confirm: ${u.username} becomes an admin.`).check();
		await make.click();
		await expect(r.getByRole('status').filter({ hasText: 'Made admin.' })).toBeVisible();
		expect((await getUser(u.username)).role).toBe('admin');

		await r.getByText('Actions').click();
		await r.getByLabel(`Confirm: ${u.username} loses admin rights.`).check();
		await r.getByRole('button', { name: 'Remove admin' }).click();
		await expect(r.getByRole('status').filter({ hasText: 'Admin removed.' })).toBeVisible();

		// deactivate then reactivate
		await r.getByText('Actions').click();
		await r.getByLabel(`Confirm: ${u.username} is signed out everywhere and cannot sign in.`).check();
		await r.getByRole('button', { name: 'Deactivate' }).click();
		await expect(r.getByText('Deactivated', { exact: true })).toBeVisible();
		expect((await getUser(u.username)).active).toBe(false);
		await r.getByText('Actions').click();
		await r.getByRole('button', { name: 'Reactivate' }).click();
		await expect(r.getByRole('status').filter({ hasText: 'Reactivated.' })).toBeVisible();
		expect((await getUser(u.username)).active).toBe(true);
	});

	test('readable errors: you cannot demote yourself', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/users?q=e2eadmin');
		const r = row(page, 'e2eadmin');
		await expect(r.getByText('You', { exact: true })).toBeVisible();
		await r.getByText('Actions').click();
		await r.getByLabel('Confirm: e2eadmin loses admin rights.').check();
		await r.getByRole('button', { name: 'Remove admin' }).click();
		await expect(r.getByRole('alert')).toHaveText('You cannot demote or deactivate yourself.');
	});

	test('the reset link is shown once, with a copy button', async ({ page }) => {
		const u = await mkUser('rst');
		await loginAsAdmin(page);
		await page.goto(`/admin/users?q=${u.username}`);
		const r = row(page, u.username);
		await r.getByText('Actions').click();
		await r.getByRole('button', { name: 'Generate reset link' }).click();

		const panel = r.getByRole('status').filter({ hasText: 'Reset link for' });
		await expect(panel).toBeVisible();
		const url = (await panel.locator('.reset-url').innerText()).trim();
		expect(url).toMatch(/\/reset-password\?token=/);
		await expect(panel.getByText('Valid for 1 hour, single use. Share it only with the verified user.')).toBeVisible();

		await panel.getByRole('button', { name: 'Copy link' }).click();
		await expect(panel.getByText('Copied', { exact: true })).toBeVisible();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
		expect(await overflow(page)).toEqual([]);

		await page.reload();
		await expect(row(page, u.username)).toBeVisible();
		await expect(page.getByText('Reset link for')).toHaveCount(0);
		await expect(page.locator('body')).not.toContainText('reset-password?token=');
	});
});

test.describe('users: copy failure', () => {
	test('a refused clipboard says so and the link stays selectable by keyboard', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: () => Promise.reject(new Error('denied')) },
				configurable: true
			});
		});
		const u = await mkUser('rstfail');
		await loginAsAdmin(page);
		await page.goto(`/admin/users?q=${u.username}`);
		const r = page.getByRole('listitem').filter({ hasText: u.username });
		await r.locator('summary').click();
		await r.getByRole('button', { name: 'Generate reset link' }).click();
		const panel = r.getByRole('status').filter({ hasText: 'Reset link for' });
		await panel.getByRole('button', { name: 'Copy link' }).click();
		await expect(panel.getByText("Couldn't copy. Select the link and copy it.")).toBeVisible();
		await expect(panel.getByText('Copied', { exact: true })).toHaveCount(0);
		const url = panel.locator('.reset-url');
		await expect(url).toHaveAttribute('tabindex', '0');
		await url.focus();
		expect(await page.evaluate(() => getSelection()!.toString())).toContain('reset-password?token=');
	});
});

// ---------------------------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------------------------
test.describe('moderation', () => {
	test('two-step post and comment delete, and an empty state', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/moderation');
		await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
		await expect(page.getByText('No posts.')).toBeVisible();

		const a = await mkUser('mod');
		const b = await mkUser('mod');
		const [post] = await db
			.insert(schema.posts)
			.values({ userId: a.id, title: 'Remove me', body: 'Please remove this post', imagePath: await writeProof() })
			.returning();
		const [keep] = await db.insert(schema.posts).values({ userId: b.id, title: 'Fine title', body: 'A fine post' }).returning();
		await db.insert(schema.comments).values({ postId: keep.id, userId: a.id, body: 'A rude comment' });

		await page.goto('/admin/moderation');
		const art = page.getByRole('article').filter({ hasText: 'Please remove this post' });
		await expect(art.getByText(a.username)).toBeVisible();
		const heading = art.getByText('Remove me', { exact: true });
		await expect(heading).toBeVisible();
		expect(await heading.evaluate((e) => getComputedStyle(e).fontWeight)).toBe('700');
		await expect(art.getByRole('img')).toBeVisible();
		expect(await overflow(page)).toEqual([]);

		// comment first: second step needs the box
		const other = page.getByRole('article').filter({ hasText: 'A fine post' });
		await other.getByText('1 comment', { exact: true }).click();
		await other.getByText('Delete comment', { exact: true }).click();
		await other.getByRole('button', { name: 'Delete comment permanently' }).click();
		await expect(other.getByText('A rude comment')).toBeVisible();
		await other.getByLabel('Confirm: delete this comment.').check();
		await other.getByRole('button', { name: 'Delete comment permanently' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Deleted the comment.' })).toBeVisible();
		expect(await db.select().from(schema.comments).where(eq(schema.comments.postId, keep.id))).toHaveLength(0);

		await art.getByText('Delete post', { exact: true }).click();
		await art.getByRole('button', { name: 'Delete post permanently' }).click();
		expect(await db.select().from(schema.posts).where(eq(schema.posts.id, post.id))).toHaveLength(1);
		await expect(art.getByLabel('Confirm: delete the post \u201cRemove me\u201d')).toBeVisible();
		await art.getByLabel('Confirm: delete the post').check();
		await art.getByRole('button', { name: 'Delete post permanently' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Deleted the post.' })).toBeVisible();
		expect(await db.select().from(schema.posts).where(eq(schema.posts.id, post.id))).toHaveLength(0);
	});

	test('older posts load through the cursor link', async ({ page }) => {
		const a = await mkUser('mod');
		const now = Date.now();
		await db.insert(schema.posts).values(
			Array.from({ length: 21 }, (_, i) => ({
				userId: a.id,
				title: `Title ${i}`,
				body: `post number ${i}`,
				createdAt: new Date(now - i * 60_000)
			}))
		);
		await loginAsAdmin(page);
		await page.goto('/admin/moderation');
		await expect(page.getByRole('article')).toHaveCount(20);
		await page.getByRole('link', { name: 'Older posts' }).click();
		await expect(page.getByRole('article')).toHaveCount(1);
		await expect(page.getByRole('link', { name: /Back to newest/ })).toBeVisible();
	});
});

// ---------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------
test.describe('images', () => {
	test('garbage filters fall back and the form works without JavaScript', async ({ page }) => {
		await loginAsAdmin(page);
		const res = await page.goto(`/admin/images?task=%00bad&period=abc&user=${'x'.repeat(100)}&beforeId=zzz`);
		expect(res!.status()).toBe(200);
		await expect(page.getByRole('heading', { level: 1, name: 'Proof images' })).toBeVisible();
		await expect(page.getByLabel('Task', { exact: true })).toHaveValue('');
		await expect(page.getByLabel('Period', { exact: true })).toHaveValue('');
		await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
	});

	test('grid: thumbnails with captions, filters and the pager', async ({ page }) => {
		const u = await mkUser('img');
		const other = await mkUser('img');
		const file = await writeProof();
		await sub(u.id, 'milk', { image: file, status: 'approved' });
		await sub(other.id, 'beans', { image: file, status: 'pending' });
		for (let i = 0; i < 24; i++) await sub(u.id, 'descale', { image: file, status: 'rejected', ageMinutes: 60 + i });
		await loginAsAdmin(page);
		await page.goto(`/admin/images?user=${u.username}`);

		const items = page.getByRole('list', { name: 'Proof images' }).getByRole('listitem');
		await expect(items).toHaveCount(24);
		const first = items.first();
		await expect(first.getByText(u.username, { exact: true })).toBeVisible();
		await expect(first.getByText(/Approved|Pending|Rejected/)).toBeVisible();
		// phone: two columns
		const b0 = (await items.nth(0).boundingBox())!;
		const b1 = (await items.nth(1).boundingBox())!;
		const b2 = (await items.nth(2).boundingBox())!;
		expect(b1.y).toBeCloseTo(b0.y, 0);
		expect(b2.y).toBeGreaterThan(b0.y);
		expect(await overflow(page)).toEqual([]);

		await page.getByRole('link', { name: 'Load more' }).click();
		await expect(items).toHaveCount(1);
		await expect(page.getByRole('link', { name: 'Back to newest' })).toBeVisible();

		await page.goto('/admin/images');
		await page.getByLabel('Task', { exact: true }).selectOption({ label: 'Bring coffee beans' });
		await page.getByLabel('User', { exact: true }).fill(other.username);
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect(items).toHaveCount(1);
		await expect(items.first()).toContainText('Bring coffee beans');
	});

	test('laptop: four columns', async ({ page }) => {
		await page.setViewportSize(LAPTOP);
		const u = await mkUser('img');
		const file = await writeProof();
		for (let i = 0; i < 5; i++) await sub(u.id, 'milk', { image: file, status: 'approved', ageMinutes: 10 + i });
		await loginAsAdmin(page);
		await page.goto(`/admin/images?user=${u.username}`);
		const items = page.getByRole('list', { name: 'Proof images' }).getByRole('listitem');
		await expect(items).toHaveCount(5);
		const ys = await Promise.all([0, 1, 2, 3, 4].map(async (i) => Math.round((await items.nth(i).boundingBox())!.y)));
		expect(ys[3]).toBe(ys[0]);
		expect(ys[4]).toBeGreaterThan(ys[0]);
		const box = (await items.first().getByRole('img').boundingBox())!;
		expect(box.width / box.height).toBeCloseTo(4 / 3, 1);
	});

	test('per-period delete asks for confirmation and reports removed and failed', async ({ page }) => {
		const u = await mkUser('img');
		const ended = await mkEndedPeriod('Spring clean');
		const ok = await writeProof();
		// a directory under a valid proof name cannot be unlinked, which is the "failed" path
		const stuck = `${randomBytes(16).toString('hex')}.webp`;
		await mkdir(join(E2E_UPLOAD_DIR, stuck), { recursive: true });
		await sub(u.id, 'milk', { periodId: ended.id, image: ok, status: 'approved' });
		await sub(u.id, 'beans', { periodId: ended.id, image: stuck, status: 'approved' });
		await loginAsAdmin(page);
		await page.goto('/admin/images');

		const panel = page.getByRole('region', { name: 'Spring clean' });
		await expect(panel).toBeVisible();
		await panel.getByRole('button', { name: 'Delete proof images' }).click(); // blocked: no confirmation
		await expect(panel.getByText(/Removed/)).toHaveCount(0);
		await panel.getByLabel('Confirm: permanently delete all proof photos of Spring clean.').check();
		await panel.getByRole('button', { name: 'Delete proof images' }).click();
		await expect(panel.getByRole('status')).toContainText('Removed 1 image; 1 could not be removed');
		expect(await overflow(page)).toEqual([]);
	});

	test('the running period cannot be deleted and says why', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/images');
		const panel = page.getByRole('region', { name: 'E2E period' });
		await expect(panel.getByText("Images of a running period can't be deleted.")).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Delete proof images' })).toBeDisabled();
	});
});

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------
test.describe('periods', () => {
	test('active period: pending warning with a link, then end with confirmation', async ({ page }) => {
		const u = await mkUser('per');
		await sub(u.id, 'milk');
		await loginAsAdmin(page);
		await page.goto('/admin/periods');
		await expect(page.getByRole('heading', { level: 1, name: 'Periods' })).toBeVisible();
		const row = page.getByRole('listitem').filter({ hasText: 'E2E period' });
		await expect(row.getByText('Active', { exact: true })).toBeVisible();

		const warn = page.getByRole('status').filter({ hasText: 'still pending review' });
		await expect(warn).toContainText('1 submission still pending review. They can only be rejected after the period ends.');
		await expect(warn.getByRole('link', { name: 'Open the review queue' })).toHaveAttribute('href', '/admin/review');
		expect(await overflow(page)).toEqual([]);

		restorePeriod = await activePeriodId(); // ending it for real: put it back afterwards
		await page.getByRole('button', { name: 'End period' }).click(); // blocked until confirmed
		expect((await db.select().from(schema.periods).where(eq(schema.periods.id, restorePeriod!)))[0].status).toBe('active');
		await page.getByLabel(/I understand this ends the period now/).check();
		await page.getByRole('button', { name: 'End period' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Period ended.' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create period' })).toBeVisible();
		await expect(row.getByText('Ended', { exact: true })).toBeVisible();
	});

	test('create a period; a concurrent active one is a readable inline error', async ({ page }) => {
		await withoutActivePeriod();
		await loginAsAdmin(page);
		await page.goto('/admin/periods');
		await expect(page.getByRole('button', { name: 'End period' })).toHaveCount(0);

		// someone else starts a period while this form is open
		const [racer] = await db.insert(schema.periods).values({ name: 'Racer', startsAt: new Date() }).returning();
		periodIds.push(racer.id);
		await page.getByLabel('Period name').fill('Mine');
		await page.getByRole('button', { name: 'Create period' }).click();
		await expect(page.getByRole('alert')).toHaveText('A period is already active. End it before starting a new one.');
		await expect(page.getByLabel('Period name')).toHaveValue('Mine');

		await db.update(schema.periods).set({ status: 'ended', endsAt: new Date() }).where(eq(schema.periods.id, racer.id));
		await page.reload();
		await page.getByLabel('Period name').fill('Fresh start');
		await page.getByRole('button', { name: 'Create period' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Period "Fresh start" started.' })).toBeVisible();
		const [fresh] = await db.select().from(schema.periods).where(eq(schema.periods.name, 'Fresh start'));
		periodIds.push(fresh.id);
	});

	test('winners show with an avatar, points and a tie mark', async ({ page }) => {
		const a = await mkUser('win');
		const b = await mkUser('win');
		const solo = await mkUser('win');
		const tied = await mkEndedPeriod('Tied month');
		const clear = await mkEndedPeriod('Clear month');
		await db.insert(schema.periodWinners).values([
			{ periodId: tied.id, userId: a.id, points: 12, rank: 1 },
			{ periodId: tied.id, userId: b.id, points: 12, rank: 1 },
			{ periodId: clear.id, userId: solo.id, points: 9, rank: 1 }
		]);
		await loginAsAdmin(page);
		await page.goto('/admin/periods');
		const t = page.getByRole('listitem').filter({ hasText: 'Tied month' });
		await expect(t.getByText('Ended', { exact: true })).toBeVisible();
		await expect(t).toContainText(a.username);
		await expect(t).toContainText(b.username);
		await expect(t.getByText('Tied', { exact: true })).toBeVisible();
		await expect(t).toContainText('12 pts');
		const c = page.getByRole('listitem').filter({ hasText: 'Clear month' });
		await expect(c).toContainText(solo.username);
		await expect(c.getByText('Tied', { exact: true })).toHaveCount(0);
		expect(await overflow(page)).toEqual([]);
	});

	test.describe('dark', () => {
		test.use({ colorScheme: 'dark' });
		test('warning and rows stay readable', async ({ page }) => {
			const u = await mkUser('per');
			await sub(u.id, 'milk');
			await loginAsAdmin(page);
			await page.goto('/admin/periods');
			await expect(page.getByText('still pending review')).toBeVisible();
			const r = await lowestContrast(page, 'main');
			expect(r.ratio, `periods text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
		});
	});
});

// ---------------------------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------------------------
async function seedActivity(userId: number) {
	const day = 86_400_000;
	const rows: { userId: number; type: string; createdAt: Date }[] = [];
	for (let d = 0; d < 6; d++) {
		for (let i = 0; i < 2 + d; i++) {
			rows.push({ userId, type: 'app_open', createdAt: new Date(Date.now() - d * day - i * 3_600_000) });
		}
		for (let i = 0; i < d; i++) {
			rows.push({ userId, type: 'task_submitted', createdAt: new Date(Date.now() - d * day - i * 7_200_000) });
		}
	}
	await db.insert(schema.events).values(rows);
}

test.describe('analytics', () => {
	test('range and bucket controls are links and work without JavaScript', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false, viewport: PHONE });
		const page = await context.newPage();
		await loginAsAdmin(page);
		await page.goto('/admin/analytics');
		await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
		const range = page.getByRole('navigation', { name: 'Date range' });
		await expect(range.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page');
		await range.getByRole('link', { name: 'Last 7 days' }).click();
		await expect(page).toHaveURL(/range=7d/);
		await expect(page.getByRole('navigation', { name: 'Date range' }).getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('aria-current', 'page');
		await page.getByRole('navigation', { name: 'Group by' }).getByRole('link', { name: 'Week' }).click();
		await expect(page).toHaveURL(/bucket=week/);
		await expect(page).toHaveURL(/range=7d/); // the other choice is kept
		await expect(page.getByRole('navigation', { name: 'Group by' }).getByRole('link', { name: 'Week' })).toHaveAttribute('aria-current', 'page');
		await context.close();
	});

	test('garbage params fall back to the defaults', async ({ page }) => {
		await loginAsAdmin(page);
		const res = await page.goto('/admin/analytics?range=bogus&bucket=%00&periodId=abc');
		expect(res!.status()).toBe(200);
		await expect(page.getByRole('navigation', { name: 'Date range' }).getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('navigation', { name: 'Group by' }).getByRole('link', { name: 'Day' })).toHaveAttribute('aria-current', 'page');
	});

	test('charts keep role img, a label and a table; the heatmap scrolls inside its container', async ({ page }) => {
		const u = await mkUser('an');
		await seedActivity(u.id);
		await sub(u.id, 'milk', { status: 'approved', points: 4 });
		await sub(u.id, 'beans', { status: 'approved', points: 6 });
		await loginAsAdmin(page);
		await page.goto('/admin/analytics');

		await expect(page.getByText('App opens', { exact: true }).first()).toBeVisible();
		const charts = page.getByRole('img', { name: /chart from/ });
		await expect(charts).toHaveCount(2);
		await expect(charts.first()).toHaveAttribute('aria-label', /Daily chart from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: .* app opens, .* task submissions\./);
		// legend names the series in text
		await expect(page.getByRole('list', { name: 'Legend' }).first()).toContainText('App opens');
		await expect(page.getByRole('list', { name: 'Legend' }).first()).toContainText('Submissions');
		await page.getByText('Show as table').first().click();
		await expect(page.getByRole('table').first()).toBeVisible();

		// distribution and contributors
		await expect(page.getByRole('heading', { level: 2, name: 'Top contributors' })).toBeVisible();
		await expect(page.getByRole('listitem').filter({ hasText: u.username })).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: 'Task distribution' })).toBeVisible();

		// heatmap: focusable scroller, wider than the phone, the page itself does not scroll
		const region = page.getByRole('region', { name: 'Submissions heatmap' });
		await expect(region).toHaveAttribute('tabindex', '0');
		expect(await region.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
		expect(await overflow(page)).toEqual([]);
		await region.focus();
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
		await expect(region.getByRole('cell').filter({ hasText: /^\d+$/ }).first()).toBeVisible();
		await expect(page.getByText(/\(max\)/)).toBeVisible();
	});

	test('five-digit figures stay inside their columns at 360 px', async ({ page }) => {
		await page.setViewportSize(SMALL);
		const u = await mkUser('big');
		const now = Date.now();
		const rows = (type: string, n: number) =>
			Array.from({ length: n }, (_, i) => ({ userId: u.id, type, createdAt: new Date(now - (i % 600) * 60_000) }));
		for (let i = 0; i < 12; i++) await db.insert(schema.events).values(rows('app_open', 1000));
		for (let i = 0; i < 11; i++) await db.insert(schema.events).values(rows('task_submitted', 1000));
		await loginAsAdmin(page);
		await page.goto('/admin/analytics?range=7d');
		const figs = page.locator('.stats dd');
		await expect(figs).toHaveCount(3);
		await expect(figs.first()).toContainText(/\d{2},\d{3}/);
		expect(await overflow(page)).toEqual([]);
		const boxes = await figs.evaluateAll((els) =>
			els.map((e) => ({ r: e.getBoundingClientRect(), over: e.scrollWidth > e.clientWidth }))
		);
		for (let i = 0; i < 3; i++) expect(boxes[i].over).toBe(false);
		expect(boxes[0].r.right).toBeLessThanOrEqual(boxes[1].r.left);
		expect(boxes[1].r.right).toBeLessThanOrEqual(boxes[2].r.left);
	});

	test('360 px wide: no horizontal page overflow', async ({ page }) => {
		await page.setViewportSize(SMALL);
		const u = await mkUser('an');
		await seedActivity(u.id);
		await loginAsAdmin(page);
		await page.goto('/admin/analytics');
		await expect(page.getByRole('region', { name: 'Submissions heatmap' })).toBeVisible();
		expect(await overflow(page)).toEqual([]);
	});

	test('empty state', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/review'); // records the admin visit (and throttles the next one)
		await db.delete(schema.events);
		await page.goto('/admin/analytics?range=7d');
		await expect(page.getByText('No activity in this range.').first()).toBeVisible();
		await expect(page.getByRole('img', { name: /chart from/ })).toHaveCount(0);
	});

	test.describe('dark', () => {
		test.use({ colorScheme: 'dark' });
		test('chart text and marks keep their contrast', async ({ page }) => {
			const u = await mkUser('an');
			await seedActivity(u.id);
			await sub(u.id, 'milk', { status: 'approved', points: 4 });
			await loginAsAdmin(page);
			await page.goto('/admin/analytics');
			await expect(page.getByRole('region', { name: 'Submissions heatmap' })).toBeVisible();
			const r = await lowestContrast(page, 'main');
			expect(r.ratio, `analytics text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
			expect(await markContrast(page, '.plot .bar.s0')).toBeGreaterThanOrEqual(3);
			expect(await markContrast(page, '.plot .bar.s1')).toBeGreaterThanOrEqual(3);
			expect(await overflow(page)).toEqual([]);
		});
	});

	test.describe('light', () => {
		test.use({ colorScheme: 'light' });
		test('chart marks keep 3:1 against the surface', async ({ page }) => {
			const u = await mkUser('an');
			await seedActivity(u.id);
			await loginAsAdmin(page);
			await page.goto('/admin/analytics');
			await expect(page.getByRole('region', { name: 'Submissions heatmap' })).toBeVisible();
			expect(await markContrast(page, '.plot .bar.s0')).toBeGreaterThanOrEqual(3);
			expect(await markContrast(page, '.plot .bar.s1')).toBeGreaterThanOrEqual(3);
			const r = await lowestContrast(page, 'main');
			expect(r.ratio, `analytics text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
		});
	});
});

// ---------------------------------------------------------------------------------------------
// Sidebar focus ring (parked from Task 2)
// ---------------------------------------------------------------------------------------------
test.describe('sidebar focus ring', () => {
	test.use({ viewport: LAPTOP });
	test('a focused item outline is not clipped by the scrolling rail', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/review');
		const scroller = page.locator('.scroller');
		await expect(scroller).toBeVisible();
		const home = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Home' });
		await home.focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible matches
		await expect(home).toBeFocused();
		const probe = await home.evaluate((el) => {
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			const grow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
			const s = el.closest('.scroller')!.getBoundingClientRect();
			return {
				style: cs.outlineStyle,
				outline: { l: r.left - grow, r: r.right + grow, t: r.top - grow, b: r.bottom + grow },
				clip: { l: s.left, r: s.right, t: s.top, b: s.bottom }
			};
		});
		expect(probe.style).not.toBe('none');
		expect(probe.outline.l).toBeGreaterThanOrEqual(probe.clip.l - 0.5);
		expect(probe.outline.r).toBeLessThanOrEqual(probe.clip.r + 0.5);
		expect(probe.outline.t).toBeGreaterThanOrEqual(probe.clip.t - 0.5);
		expect(probe.outline.b).toBeLessThanOrEqual(probe.clip.b + 0.5);
	});
});

// ---------------------------------------------------------------------------------------------
// Camera overlay (opened from a photo tile on Home)
// ---------------------------------------------------------------------------------------------
test.describe('camera overlay', () => {
	test.use({ permissions: ['camera'] });

	async function openFromTile(page: Page, task = 'beans') {
		const me = await mkUser('cam');
		await giveSession(page.context(), me.username, me.password);
		await page.goto('/');
		const tile = page.locator(`[data-task="${task}"]`);
		if (task !== 'cutlery') await expect(tile).toHaveAttribute('data-state', 'photo');
		await tile.click();
		const dialog = page.getByRole('dialog', { name: 'Take a photo' });
		await expect(dialog).toBeVisible();
		return { tile, dialog };
	}

	test('opens with focus inside, a visible ring, 44 px controls; Escape closes and returns focus', async ({ page }) => {
		const { tile, dialog } = await openFromTile(page);
		await expect(dialog.getByRole('button', { name: 'Take photo' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
		expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

		for (const name of ['Take photo', 'Cancel']) {
			expect(await height(dialog.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
		}
		const shutter = (await dialog.getByRole('button', { name: 'Take photo' }).boundingBox())!;
		expect(shutter.width).toBeGreaterThanOrEqual(72);

		// Tab stays inside the overlay, and the focused control shows a ring
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab');
			expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
		}
		const ring = await page.evaluate(() => {
			const cs = getComputedStyle(document.activeElement!);
			return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
		});
		expect(ring.style).not.toBe('none');
		expect(ring.width).toBeGreaterThanOrEqual(2);

		// full screen, nothing scrolls sideways
		const box = (await dialog.boundingBox())!;
		expect(box.width).toBe(PHONE.width);
		expect(box.height).toBe(PHONE.height);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(tile).toBeFocused();
	});

	test('cancel closes and returns focus to the tile', async ({ page }) => {
		const { tile, dialog } = await openFromTile(page);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(tile).toBeFocused();
	});

	test('capture shows a review with retake and use photo', async ({ page }) => {
		const { dialog } = await openFromTile(page);
		await dialog.getByRole('button', { name: 'Take photo' }).click();
		await expect(dialog.getByRole('img', { name: 'Captured preview' })).toBeVisible();
		for (const name of ['Retake', 'Use photo', 'Cancel']) {
			expect(await height(dialog.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
		}
		await dialog.getByRole('button', { name: 'Retake' }).click();
		await expect(dialog.getByRole('button', { name: 'Take photo' })).toBeVisible();
	});

	test('the "No cutlery detected" banner renders when the model runs and finds nothing', async ({ page }) => {
		test.setTimeout(120_000);
		const { dialog } = await openFromTile(page, 'cutlery');
		await dialog.getByRole('button', { name: 'Take photo' }).click();
		const banner = dialog.getByRole('alert');
		await expect(banner).toBeVisible({ timeout: 90_000 });
		// Needs the model download; without network the other banner shows and this check does not apply.
		const unreachable = (await banner.innerText()).startsWith("Couldn't check");
		if (unreachable) {
			console.warn('cutlery model download unreachable: skipping the "No cutlery detected" check');
			// CI has network: a missing model there is a real failure, not a reason to skip.
			if (process.env.CI) throw new Error('cutlery model download unreachable in CI');
		}
		test.skip(unreachable, 'model download unreachable');
		await expect(banner).toHaveText('No cutlery detected, retake');
		await expect(banner.locator('svg')).toHaveCount(1);
	});

	test('the "couldn\'t check" banner renders with an icon and text', async ({ page }) => {
		test.setTimeout(90_000);
		// The cutlery model comes from a remote host; cutting off every other origin makes the check fail.
		await page.route((url) => url.origin !== E2E_ORIGIN && url.protocol.startsWith('http'), (r) => r.abort());
		const { dialog } = await openFromTile(page, 'cutlery');
		await dialog.getByRole('button', { name: 'Take photo' }).click();
		const banner = dialog.getByRole('alert');
		await expect(banner).toHaveText("Couldn't check the photo for cutlery", { timeout: 60_000 });
		await expect(banner.locator('svg')).toHaveCount(1);
		const r = await lowestContrast(page, '[role="dialog"]');
		expect(r.ratio, `camera text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
	});

	test('permission denied says so plainly and offers Try again and Close', async ({ page }) => {
		await page.addInitScript(() => {
			navigator.mediaDevices.getUserMedia = () =>
				Promise.reject(new DOMException('denied', 'NotAllowedError'));
		});
		const { tile, dialog } = await openFromTile(page);
		const alert = dialog.getByRole('alert');
		await expect(alert).toContainText('Camera access was blocked.');
		await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
		await alert.getByRole('button', { name: 'Close' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(tile).toBeFocused();
	});

	test('without a camera API the file input is a normal button', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
		});
		const { dialog } = await openFromTile(page);
		const choose = dialog.getByText('Choose a photo', { exact: true });
		await expect(choose).toBeVisible();
		expect(await height(choose)).toBeGreaterThanOrEqual(44);
		const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#445566' } }).png().toBuffer();
		await dialog.locator('input[type="file"]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: png });
		await expect(dialog.getByRole('img', { name: 'Captured preview' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Use photo' })).toBeVisible();
	});

	test('the unsupported-secure-context copy is plain', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
		});
		const { dialog } = await openFromTile(page);
		await expect(dialog.getByRole('alert')).toContainText('The camera only works on a secure (HTTPS) connection.');
		await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Try again' })).toHaveCount(0);
	});
});
