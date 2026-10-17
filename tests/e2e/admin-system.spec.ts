import { expect, test } from '@playwright/test';
import { loginAsAdmin, loginAsNewUser, lowestContrast, overflowReport } from './helpers';

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

test.describe('admin System page', () => {
	test.use({ viewport: LAPTOP });

	test('shows an overall status chip and every section with values', async ({ page }) => {
		await loginAsAdmin(page);
		const res = await page.goto('/admin/system');
		expect(res?.status()).toBe(200);
		await expect(page.getByRole('heading', { level: 1, name: 'System' })).toBeVisible();

		const chip = page.getByTestId('overall-chip');
		await expect(chip).toHaveText(/^(OK|Attention|Critical)$/);
		await expect(chip.locator('svg')).toHaveCount(1); // icon and text, never colour alone

		for (const name of ['Disk', 'Photos', 'Database', 'App', 'VPS host', 'Activity and capacity', 'Notes']) {
			await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
		}
		await expect(page.getByText('Updated').first()).toBeVisible();
		await expect(page.locator('time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

		const main = page.locator('main');
		// Disk and database always have figures on a working host.
		await expect(main.getByText('Total', { exact: true }).first()).toBeVisible();
		await expect(main.getByText('Response time')).toBeVisible();
		await expect(main.getByText(/\d+ of \d+/).first()).toBeVisible();
		await expect(main.getByText('Version', { exact: true })).toBeVisible();
		await expect(main.getByText('Uptime', { exact: true })).toBeVisible();
		await expect(main.getByRole('link', { name: 'Manage photos' })).toHaveAttribute('href', '/admin/images');
		await expect(main.getByText('Backups run on the VPS', { exact: false })).toBeVisible();
		await expect(main.getByText('Photos of a finished period can be deleted from')).toBeVisible();

		// No server detail leaks into the page.
		const text = await main.innerText();
		for (const needle of ['postgres://', '/proc', '/sys/fs/cgroup', 'DATABASE_URL', 'SESSION_SECRET']) {
			expect(text).not.toContain(needle);
		}
	});

	test('a non-admin gets 403', async ({ page }) => {
		await loginAsNewUser(page);
		const res = await page.goto('/admin/system');
		expect(res?.status()).toBe(403);
	});

	test('an anonymous visitor is sent to sign in', async ({ page }) => {
		await page.goto('/admin/system');
		await expect(page).toHaveURL(/\/login/);
	});

	test('the sidebar lists System and marks it current', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/system');
		const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^System/ });
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('aria-current', 'page');
	});

	test('the auto-refresh toggle is off by default and exposes its state and interval', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/system');
		const toggle = page.getByRole('checkbox', { name: 'Auto-refresh every 30 s' });
		await expect(toggle).not.toBeChecked();
		await expect(page.locator('[data-interval-seconds]')).toHaveAttribute('data-interval-seconds', '30');
		await toggle.check();
		await expect(toggle).toBeChecked();
		await toggle.uncheck();
		await expect(toggle).not.toBeChecked();
		await expect(page.getByRole('status')).toBeAttached(); // the polite live region
	});

	test('Refresh reloads in place and Updated stays a valid time', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/system');
		const reload = page.waitForResponse((r) => r.url().includes('/admin/system') && r.status() === 200);
		await page.getByRole('link', { name: 'Refresh' }).click();
		await reload;
		await expect.poll(async () => page.locator('time').innerText()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	test('dark mode keeps text readable', async ({ browser }) => {
		const context = await browser.newContext({ viewport: LAPTOP, colorScheme: 'dark' });
		const page = await context.newPage();
		await loginAsAdmin(page);
		await page.goto('/admin/system');
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
		await context.close();
	});
});

test.describe('admin System page on phones', () => {
	for (const width of [360, 390]) {
		test(`no horizontal overflow at ${width}px, and the section nav lists System`, async ({ page }) => {
			await page.setViewportSize({ width, height: width === 360 ? 740 : PHONE.height });
			await loginAsAdmin(page);
			await page.goto('/admin/system');
			await expect(page.getByTestId('overall-chip')).toBeVisible();
			expect(await overflowReport(page)).toEqual([]);
			const link = page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'System' });
			await expect(link).toHaveAttribute('aria-current', 'page');
		});
	}
});

test.describe('admin System page without JavaScript', () => {
	test.use({ viewport: LAPTOP, javaScriptEnabled: false });

	test('Refresh is a plain link and the auto-refresh toggle is not offered', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/admin/system');
		await expect(page.getByTestId('overall-chip')).toBeVisible();
		await expect(page.getByRole('checkbox', { name: /Auto-refresh/ })).toHaveCount(0);
		const refresh = page.getByRole('link', { name: 'Refresh' });
		// SvelteKit renders relative hrefs on the server; they still resolve to this page.
		expect(await refresh.evaluate((a) => new URL((a as HTMLAnchorElement).href).pathname)).toBe('/admin/system');
		await Promise.all([page.waitForURL('**/admin/system'), refresh.click()]);
		await expect(page.locator('time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
	});
});
