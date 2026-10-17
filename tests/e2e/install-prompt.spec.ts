import { AxeBuilder } from '@axe-core/playwright';
import { devices, expect, test, webkit, type Browser, type Page } from '@playwright/test';
import { createUser, giveSession, lowestContrast, overflowReport } from './helpers';

const IPHONE_SAFARI =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const INSTAGRAM =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 335.0.0.37.89 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 593059562)';

type Opts = { userAgent?: string; width?: number; height?: number; standalone?: boolean; dark?: boolean; signedIn?: boolean; onboarded?: boolean };

/** A fresh phone-like context (optionally signed in) with navigator.standalone stubbed. */
async function open(browser: Browser, o: Opts = {}): Promise<Page> {
	const mobile = o.userAgent !== undefined;
	const context = await browser.newContext({
		userAgent: o.userAgent,
		viewport: { width: o.width ?? 390, height: o.height ?? 844 },
		isMobile: mobile,
		hasTouch: mobile,
		colorScheme: o.dark ? 'dark' : 'light',
		reducedMotion: 'reduce'
	});
	if (o.standalone) {
		await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
	}
	if (o.signedIn !== false) {
		const { username, password } = await createUser(undefined, { onboarded: o.onboarded ?? true });
		await giveSession(context, username, password);
	}
	return context.newPage();
}

const banner = (page: Page) => page.getByRole('region', { name: 'Install the app' });
const homeReady = (page: Page) => page.locator('.tiles[data-ready]').waitFor();

test('iPhone Safari sees the Share steps; Got it hides them and a reload keeps them hidden', async ({ browser }) => {
	const page = await open(browser, { userAgent: IPHONE_SAFARI });
	await page.goto('/');
	await homeReady(page);
	await expect(banner(page)).toBeVisible();
	await expect(banner(page).getByRole('heading', { level: 2, name: 'Add Kitchen Care to your Home Screen' })).toBeVisible();
	await expect(banner(page).getByRole('listitem')).toHaveCount(3);
	await expect(banner(page)).toContainText('Tap the Share button in Safari');
	await expect(banner(page).locator('svg[aria-hidden="true"]').first()).toBeVisible();

	await banner(page).getByRole('button', { name: 'Got it' }).click();
	await expect(banner(page)).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('kc.install.dismissed'))).toMatch(/^\d{4}-\d\d-\d\dT/);

	await page.reload();
	await homeReady(page);
	await expect(banner(page)).toHaveCount(0);

	await page.goto('/profile');
	const section = page.getByRole('region', { name: 'Install the app' });
	await expect(section).toBeVisible();
	await expect(section).toContainText('Tap the Share button in Safari');
	await page.context().close();
});

test('a dismissal older than 30 days no longer hides the banner', async ({ browser }) => {
	const page = await open(browser, { userAgent: IPHONE_SAFARI });
	await page.addInitScript(() =>
		localStorage.setItem('kc.install.dismissed', new Date(Date.now() - 31 * 864e5).toISOString())
	);
	await page.goto('/');
	await homeReady(page);
	await expect(banner(page)).toBeVisible();
	await page.context().close();
});

test('when the app is already installed there is no banner and Profile says so', async ({ browser }) => {
	const page = await open(browser, { userAgent: IPHONE_SAFARI, standalone: true });
	await page.goto('/');
	await homeReady(page);
	await expect(banner(page)).toHaveCount(0);
	await page.goto('/profile');
	await expect(page.getByText('The app is installed on this device.')).toBeVisible();
	await page.context().close();
});

test('an in-app browser is told to open the page in a real browser', async ({ browser }) => {
	const page = await open(browser, { userAgent: INSTAGRAM });
	await page.goto('/');
	await homeReady(page);
	await expect(banner(page)).toContainText('Open this page in your browser to install');
	await expect(banner(page)).toContainText('Choose Open in Safari');
	await page.context().close();
});

test('a desktop browser with no install support shows no banner and a neutral Profile line', async ({ browser }) => {
	const page = await open(browser);
	await page.goto('/');
	await homeReady(page);
	await expect(banner(page)).toHaveCount(0);
	await page.goto('/profile');
	await expect(page.getByText('Open this page in Safari on iPhone or Chrome on Android to install it.')).toBeVisible();
	await page.context().close();
});

test('Chromium offers a real Install button that calls the browser prompt', async ({ browser }) => {
	const page = await open(browser);
	await page.goto('/');
	await homeReady(page);
	await page.evaluate(() => {
		const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
		(window as unknown as { prompted: number }).prompted = 0;
		e.prompt = async () => {
			(window as unknown as { prompted: number }).prompted++;
		};
		e.userChoice = Promise.resolve({ outcome: 'accepted' });
		window.dispatchEvent(e);
	});
	const button = banner(page).getByRole('button', { name: 'Install app' });
	await expect(button).toBeVisible();
	await button.click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { prompted: number }).prompted)).toBe(1);
	await expect(banner(page)).toHaveCount(0);
	await page.context().close();
});

test('no banner on login, onboarding or the offline page', async ({ browser }) => {
	const anon = await open(browser, { userAgent: IPHONE_SAFARI, signedIn: false });
	await anon.goto('/login');
	await expect(anon.getByRole('button', { name: /sign in|log in/i }).first()).toBeVisible();
	await expect(banner(anon)).toHaveCount(0);
	await anon.goto('/offline/');
	await expect(anon.locator('body')).not.toBeEmpty();
	await expect(banner(anon)).toHaveCount(0);
	await anon.context().close();

	const fresh = await open(browser, { userAgent: IPHONE_SAFARI, onboarded: false });
	await fresh.goto('/onboarding');
	await expect(fresh).toHaveURL(/\/onboarding/);
	await expect(fresh.locator('h1').first()).toBeVisible();
	await expect(banner(fresh)).toHaveCount(0);
	await fresh.context().close();
});

test('the banner sits above the tab bar and does not overflow a 360 px screen', async ({ browser }) => {
	const page = await open(browser, { userAgent: IPHONE_SAFARI });
	await page.goto('/');
	await homeReady(page);
	const box = (await banner(page).boundingBox())!;
	const bar = (await page.locator('nav.tabbar').boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
	await expect(banner(page)).toHaveCSS('position', 'static');
	await page.context().close();

	const small = await open(browser, { userAgent: IPHONE_SAFARI, width: 360, height: 740 });
	await small.goto('/');
	await homeReady(small);
	await expect(banner(small)).toBeVisible();
	expect(await overflowReport(small)).toEqual([]);
	await small.context().close();
});

test('banner text keeps AA contrast in dark mode', async ({ browser }) => {
	const page = await open(browser, { userAgent: IPHONE_SAFARI, dark: true });
	await page.goto('/');
	await homeReady(page);
	await expect(banner(page)).toBeVisible();
	const { ratio } = await lowestContrast(page, '[aria-label="Install the app"]');
	expect(ratio).toBeGreaterThanOrEqual(4.5);
	await page.context().close();
});

test('real WebKit engine with the iPhone 15 profile shows the Safari steps', async () => {
	let browser: Browser;
	try {
		browser = await webkit.launch();
	} catch {
		test.skip(true, 'WebKit is not installed (npx playwright install webkit)');
		return;
	}
	try {
		const context = await browser.newContext({ ...devices['iPhone 15'] });
		const { username, password } = await createUser();
		await giveSession(context, username, password);
		const page = await context.newPage();
		await page.goto('/');
		await homeReady(page);
		await expect(banner(page)).toContainText('Tap the Share button in Safari');
		expect(await overflowReport(page)).toEqual([]);
	} finally {
		await browser.close();
	}
});

for (const dark of [false, true]) {
	test(`axe finds nothing serious on Home and Profile with the install help showing (${dark ? 'dark' : 'light'})`, async ({ browser }) => {
		const page = await open(browser, { userAgent: IPHONE_SAFARI, dark });
		for (const path of ['/', '/profile']) {
			await page.goto(path);
			await expect(banner(page)).toBeVisible();
			const { violations } = await new AxeBuilder({ page }).analyze();
			const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
			expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
		}
		await page.context().close();
	});
}
