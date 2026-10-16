import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from './env';
import * as schema from '../../src/lib/server/db/schema';
import { createUser, db, getUser, giveSession, loginAsAdmin, loginAsNewUser } from './helpers';

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const toggle = (page: Page) =>
	page.getByRole('button', { name: /^(Collapse|Expand) sidebar$/ });

async function widthOf(page: Page, selector: string) {
	return page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().width);
}

test.describe('phone', () => {
	test.use({ viewport: PHONE });

	test('shows a bottom tab bar with four tabs and no sidebar', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/feed');
		await expect(mainNav(page)).toHaveCount(1);
		const nav = mainNav(page);
		await expect(nav.getByRole('link')).toHaveText(['Home', 'Feed', 'Leaderboard', 'Profile']);
		await expect(nav.getByRole('link', { name: 'Feed' })).toHaveAttribute('aria-current', 'page');
		await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
		await expect(page.getByRole('button', { name: /sidebar/ })).toHaveCount(0);
		const box = await nav.boundingBox();
		expect(box!.y + box!.height).toBeCloseTo(PHONE.height, 0);
		expect(box!.height).toBeGreaterThanOrEqual(56);
	});

	test('the last element is not covered by the bar when scrolled to the bottom', async ({
		page
	}) => {
		await loginAsNewUser(page);
		await page.goto('/profile');
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const { barTop, mainBottom } = await page.evaluate(() => ({
			barTop: document.querySelector('nav.tabbar')!.getBoundingClientRect().top,
			mainBottom: document.querySelector('main')!.getBoundingClientRect().bottom
		}));
		expect(mainBottom).toBeLessThanOrEqual(barTop + 0.5);
	});

	test('the shell does not cause horizontal scroll at 360px', async ({ page }) => {
		await loginAsAdmin(page);
		await page.setViewportSize({ width: 360, height: 740 });
		for (const path of ['/', '/feed', '/leaderboard', '/profile', '/admin/review']) {
			await page.goto(path);
			const m = await page.evaluate(() => ({
				doc: document.documentElement.scrollWidth,
				body: document.body.scrollWidth,
				inner: window.innerWidth,
				shell: ['nav.tabbar', 'nav.sections', 'main'].map((s) => {
					const el = document.querySelector(s);
					return el ? el.getBoundingClientRect().right : 0;
				})
			}));
			expect(m.doc, path).toBeLessThanOrEqual(m.inner);
			expect(m.body, path).toBeLessThanOrEqual(m.inner);
			for (const right of m.shell) expect(right, path).toBeLessThanOrEqual(m.inner);
		}
	});

	test('an admin page shows the scrollable section nav; Profile links to Admin for admins only', async ({
		page
	}) => {
		await loginAsAdmin(page);
		await page.goto('/admin/users');
		const sections = page.getByRole('navigation', { name: 'Admin sections' });
		await expect(sections.getByRole('link')).toHaveText([
			'Periods',
			'Review',
			'Users',
			'Moderation',
			'Images',
			'Analytics'
		]);
		await expect(sections.getByRole('link', { name: 'Users' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		const box = await sections.getByRole('link', { name: 'Users' }).boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
		await page.goto('/profile');
		await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	});

	test('a non-admin sees no Admin link on Profile', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/profile');
		await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
	});

	test('the bar paints the surface colour in dark mode', async ({ browser }) => {
		const context = await browser.newContext({ viewport: PHONE, colorScheme: 'dark' });
		const page = await context.newPage();
		await loginAsNewUser(page);
		await page.goto('/');
		await expect(mainNav(page)).toHaveCSS('background-color', 'rgb(24, 33, 28)');
		await context.close();
	});
});

test.describe('breakpoint', () => {
	test('899px still uses the bottom bar and 900px switches to the expanded sidebar', async ({
		page
	}) => {
		await loginAsNewUser(page);
		await page.setViewportSize({ width: 899, height: 800 });
		await page.goto('/');
		await expect(mainNav(page)).toHaveCount(1);
		await expect(page.locator('nav.tabbar')).toBeVisible();
		await expect(toggle(page)).toHaveCount(0);

		await page.setViewportSize({ width: 900, height: 800 });
		await expect(page.locator('nav.tabbar')).toBeHidden();
		await expect(mainNav(page)).toHaveCount(1);
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(toggle(page)).toHaveAccessibleName('Collapse sidebar');
		await expect(mainNav(page).getByRole('link', { name: 'History' })).toBeVisible();
		await expect(mainNav(page).getByText('Leaderboard').first()).toBeVisible();
	});
});

test.describe('laptop sidebar', () => {
	test.use({ viewport: LAPTOP });

	test('collapses to a 72px rail, keeps labels and persists across reload', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/');
		expect(await widthOf(page, '#sidebar')).toBeCloseTo(240, 0);

		await toggle(page).click();
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(toggle(page)).toHaveAccessibleName('Expand sidebar');
		await expect.poll(() => widthOf(page, '#sidebar')).toBeCloseTo(72, 0);

		// Labels are exposed to assistive tech but not painted.
		const link = mainNav(page).getByRole('link', { name: 'Leaderboard' });
		await expect(link).toBeVisible();
		const label = link.locator('.label');
		await expect(label).toHaveCount(1);
		expect((await label.boundingBox())!.width).toBeLessThanOrEqual(1);
		const target = await link.boundingBox();
		expect(target!.width).toBeGreaterThanOrEqual(44);
		expect(target!.height).toBeGreaterThanOrEqual(44);
		const t = await toggle(page).boundingBox();
		expect(t!.width).toBeGreaterThanOrEqual(44);
		expect(t!.height).toBeGreaterThanOrEqual(44);

		await page.reload();
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
		expect(await widthOf(page, '#sidebar')).toBeCloseTo(72, 0);
	});

	test('the server already renders the saved state (no flash)', async ({ page }) => {
		await loginAsNewUser(page);
		await page.context().addCookies([{ name: 'kc_nav', value: 'collapsed', url: E2E_ORIGIN }]);
		const html = await (await page.request.get('/')).text();
		expect(html).toContain('data-nav="collapsed"');
		await page.context().addCookies([{ name: 'kc_nav', value: 'expanded', url: E2E_ORIGIN }]);
		expect(await (await page.request.get('/')).text()).toContain('data-nav="expanded"');
		await page.context().addCookies([{ name: 'kc_nav', value: 'nonsense', url: E2E_ORIGIN }]);
		expect(await (await page.request.get('/')).text()).toContain('data-nav="expanded"');
	});

	test('a rail tooltip appears on keyboard focus', async ({ page }) => {
		await loginAsNewUser(page);
		await page.context().addCookies([{ name: 'kc_nav', value: 'collapsed', url: E2E_ORIGIN }]);
		await page.goto('/');
		const tip = mainNav(page).getByRole('link', { name: 'Feed' }).locator('.tip');
		await expect(tip).toBeHidden();
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab');
			if (await page.evaluate(() => document.activeElement?.textContent?.includes('Feed'))) break;
		}
		await expect(tip).toBeVisible();
		await expect(tip).toHaveText('Feed');
	});

	test('the toggle works with the keyboard (Enter and Space)', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/');
		await toggle(page).focus();
		await page.keyboard.press('Enter');
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
		await toggle(page).focus();
		await page.keyboard.press('Space');
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	});

	test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/');
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('main#main')).toBeFocused();
	});

	test('the sidebar highlights the current page', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/history');
		await expect(mainNav(page).getByRole('link', { name: 'History' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	});

	test('the sidebar shows the user and signs out', async ({ page }) => {
		const { username } = await loginAsNewUser(page);
		await page.goto('/');
		await expect(page.locator('#sidebar').getByText(username)).toBeVisible();
		await page.locator('#sidebar').getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/login/);
	});

	test('an admin sees the Admin group with the pending badge; a student does not', async ({
		page
	}) => {
		const [task] = await db.select().from(schema.tasks).limit(1);
		const { username } = await createUser();
		const student = await getUser(username);
		await db
			.insert(schema.submissions)
			.values({ userId: student.id, taskKey: task.key, status: 'pending' });

		await loginAsAdmin(page);
		await page.goto('/admin/review');
		const nav = mainNav(page);
		for (const name of ['Periods', 'Review', 'Users', 'Moderation', 'Images', 'Analytics']) {
			await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
		}
		await expect(nav.getByRole('link', { name: /^Review/ })).toHaveAttribute('aria-current', 'page');
		await expect(nav.getByRole('link', { name: /^Review/ }).locator('.badge')).toBeVisible();
		// The group is also there on a regular page.
		await page.goto('/');
		await expect(nav.getByRole('link', { name: /^Review/ }).locator('.badge')).toBeVisible();

		const other = await page.context().browser()!.newContext({ viewport: LAPTOP });
		const studentPage = await other.newPage();
		const creds = await createUser();
		await giveSession(other, creds.username, creds.password);
		await studentPage.goto('/');
		await expect(studentPage.getByRole('link', { name: 'Periods' })).toHaveCount(0);
		await expect(studentPage.getByText('Admin', { exact: true })).toHaveCount(0);
		await other.close();
	});

	test('dark mode paints the sidebar with the dark surface token', async ({ browser }) => {
		const context = await browser.newContext({ viewport: LAPTOP, colorScheme: 'dark' });
		const page = await context.newPage();
		await loginAsNewUser(page);
		await page.goto('/');
		await expect(page.locator('#sidebar')).toHaveCSS('background-color', 'rgb(24, 33, 28)');
		await context.close();
	});
});

test.describe('without JavaScript', () => {
	test.use({ viewport: LAPTOP, javaScriptEnabled: false });

	test('the toggle still works through the form POST and persists', async ({ page }) => {
		await loginAsNewUser(page);
		await page.goto('/profile');
		await toggle(page).click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/profile`);
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
		await page.goto('/feed');
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
		await toggle(page).click();
		await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	});
});
