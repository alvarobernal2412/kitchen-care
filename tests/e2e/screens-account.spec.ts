import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { inArray } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '../../src/lib/server/db/schema';
import { createResetToken } from '../../src/lib/server/auth/reset';
import { ADMIN_PASSWORD, ADMIN_USERNAME, E2E_ORIGIN, TEST_PASSWORD } from './env';
import {
	createUser,
	db,
	getUser,
	giveSession,
	lowestContrast,
	uniqueUsername
} from './helpers';

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };
const SLOGAN = "Good karma pays out: Rack up your credits for this semester's grand reward.";
const SSPD = 'Software Systems Programming and Development';
const NEW_PASSWORD = 'Brand-New-Pass9#';

test.use({ viewport: PHONE });

const usernames: string[] = [];
test.afterEach(async () => {
	const names = usernames.splice(0).map((n) => n.toLowerCase());
	if (names.length) {
		await db.delete(schema.users).where(inArray(schema.users.usernameNormalized, names));
	}
});

function newName(prefix: string) {
	const n = uniqueUsername(prefix);
	usernames.push(n);
	return n;
}

async function signedIn(page: Page, onboarded = true) {
	const creds = await createUser(newName('acct'), { onboarded });
	await giveSession(page.context(), creds.username, creds.password);
	return creds;
}

/** No horizontal scroll and no element wider than the viewport. */
async function expectNoOverflow(page: Page) {
	const r = await page.evaluate(() => {
		const wide = [...document.querySelectorAll('body *')]
			.filter((el) => (el as HTMLElement).offsetParent !== null)
			.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
			.map((el) => `${el.tagName}.${el.className}`)
			.slice(0, 5);
		return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, wide };
	});
	expect(r.scroll, 'scrollWidth').toBeLessThanOrEqual(r.inner);
	expect(r.wide, 'elements past the viewport').toEqual([]);
}

async function testImage(width: number, height: number) {
	return sharp({ create: { width, height, channels: 3, background: '#cc6633' } })
		.png()
		.toBuffer();
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

/** The element the control's aria-describedby points at (must exist and be visible). */
async function describedBy(page: Page, control: ReturnType<Page['locator']>) {
	const ids = (await control.getAttribute('aria-describedby')) ?? '';
	expect(ids, 'aria-describedby').not.toBe('');
	const texts: string[] = [];
	for (const id of ids.split(/\s+/)) {
		const target = page.locator(`[id="${id}"]`);
		await expect(target).toHaveCount(1);
		texts.push((await target.textContent()) ?? '');
	}
	return texts.join(' ');
}

test.describe('onboarding', () => {
	test('stepper shows a real step indicator, no levels or tiers, and Get started lands home', async ({
		page
	}) => {
		await signedIn(page, false);
		await page.goto('/onboarding');

		await expect(h1(page)).toHaveCount(1);
		await expect(h1(page)).toHaveText('Kitchen Care Credits');
		await expect(page.getByText('Step 1 of 3')).toBeVisible();
		const bar = page.getByTestId('step-bar');
		await expect(bar).toHaveAttribute('aria-hidden', 'true');
		await expect(bar.locator('i')).toHaveCount(3);
		await expect(bar.locator('i[data-on]')).toHaveCount(1);
		await expect(page.getByText(SLOGAN)).toBeVisible();

		// Tidy two-column points list: task left, +N right.
		const row = page.getByRole('listitem').filter({ hasText: 'Dishwasher' });
		await expect(row).toContainText('+2');
		const [a, b] = await Promise.all([
			row.locator('span').first().boundingBox(),
			row.locator('b').boundingBox()
		]);
		expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
		await expect(page.getByText(/photo/i).first()).toBeVisible();

		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText('Step 2 of 3')).toBeVisible();
		await expect(bar.locator('i[data-on]')).toHaveCount(2);
		await expect(page.getByRole('heading', { name: 'Your karma' })).toBeVisible();
		await expect(page.getByText(SLOGAN)).toHaveCount(0); // step 1 only
		await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText('Step 3 of 3')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'The semester prize' })).toBeVisible();
		await expect(page.getByText(/ties? share|share the win/i)).toBeVisible();
		await expect(page.getByText(/\b(levels?|tiers?)\b/i)).toHaveCount(0);

		await page.getByRole('button', { name: 'Back' }).click();
		await expect(page.getByText('Step 2 of 3')).toBeVisible();
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
		await expectNoOverflow(page);

		await page.getByRole('button', { name: 'Get started' }).click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
	});

	test('buttons are at least 44px tall and the page does not overflow at 360px', async ({
		page
	}) => {
		await page.setViewportSize(SMALL);
		await signedIn(page, false);
		await page.goto('/onboarding');
		for (const name of ['Next', 'Skip']) {
			const box = await page.getByRole('button', { name }).boundingBox();
			expect(box!.height, name).toBeGreaterThanOrEqual(44);
		}
		await expectNoOverflow(page);
	});

	test('desktop keeps a readable column and no overflow', async ({ page }) => {
		await page.setViewportSize(LAPTOP);
		await signedIn(page, false);
		await page.goto('/onboarding');
		await expect(page.getByText('Step 1 of 3')).toBeVisible();
		await expectNoOverflow(page);
	});

	test('dark mode text stays readable', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await signedIn(page, false);
		await page.goto('/onboarding');
		await expect(page.getByText('Step 1 of 3')).toBeVisible();
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `onboarding text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('shows all steps stacked, one Get started, and completes', async ({ page }) => {
			const creds = await signedIn(page, false);
			await page.goto('/onboarding');
			await expect(h1(page)).toHaveCount(1);
			await expect(page.getByRole('heading', { name: 'How credits work' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Your karma' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'The semester prize' })).toBeVisible();
			await expect(page.getByText(SLOGAN)).toHaveCount(1);
			await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(1);
			await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
			await expect(page.getByText(/Step \d of 3/)).toHaveCount(0);
			await expectNoOverflow(page);
			await page.getByRole('button', { name: 'Get started' }).click();
			await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
			expect((await getUser(creds.username)).onboardingCompleted).toBe(true);
		});
	});
});

test.describe('login', () => {
	test('has labelled fields, the wordmark and slogan, and a link to sign up', async ({ page }) => {
		await page.goto('/login');
		await expect(h1(page)).toHaveCount(1);
		await expect(h1(page)).toHaveText('Log in');
		await expect(page.getByText('Kitchen Care Credits').first()).toBeVisible();
		await expect(page.getByText(SLOGAN)).toBeVisible();
		await expect(page.getByLabel('Username')).toBeVisible();
		await expect(page.getByLabel('Password')).toBeVisible();
		await expect(page.getByText('New here?')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
			'href',
			'/signup'
		);
		await expect(page.getByRole('navigation')).toHaveCount(0); // outside the shell
		const btn = page.getByRole('button', { name: 'Log in' });
		const box = await btn.boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
		expect(box!.width).toBeGreaterThan(PHONE.width - 80); // full width on a phone
		await expectNoOverflow(page);
	});

	test('a wrong password shows an inline error tied to the field', async ({ page }) => {
		const { username } = await createUser(newName('login'));
		await page.goto('/login');
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill('Wrong-Pass-1!');
		await page.getByRole('button', { name: 'Log in' }).click();
		const alert = page.getByRole('alert');
		await expect(alert).toHaveText('Invalid username or password.');
		const pw = page.getByLabel('Password');
		await expect(pw).toHaveAttribute('aria-invalid', 'true');
		expect(await describedBy(page, pw)).toContain('Invalid username or password.');
		await expect(page.getByLabel('Username')).toHaveValue(username);
		await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
	});

	test('the submit button is enabled in the server-rendered HTML', async ({ request }) => {
		const html = await (await request.get('/login')).text();
		const button = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';
		expect(button).not.toBe('');
		expect(button).not.toMatch(/disabled/);
	});

	test('dark mode text pairs keep AA contrast, including the error', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/login');
		await page.getByLabel('Username').fill('nobody-here');
		await page.getByLabel('Password').fill('Wrong-Pass-1!');
		await page.getByRole('button', { name: 'Log in' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `login text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(bg).toBe('rgb(16, 22, 19)'); // the dark ground token, no forced light body
	});

	test('desktop: a centered column on the ground, no card', async ({ page }) => {
		await page.setViewportSize(LAPTOP);
		await page.goto('/login');
		const form = await page.locator('form').boundingBox();
		const centre = form!.x + form!.width / 2;
		expect(Math.abs(centre - LAPTOP.width / 2)).toBeLessThan(2);
		expect(form!.width).toBeLessThanOrEqual(26 * 16 + 1);
		await expectNoOverflow(page);
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('submitting logs in', async ({ page }) => {
			const { username, password } = await createUser(newName('nojslogin'));
			await page.goto('/login');
			await page.getByLabel('Username').fill(username);
			await page.getByLabel('Password').fill(password);
			await page.getByRole('button', { name: 'Log in' }).click();
			await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
		});
	});
});

test.describe('signup', () => {
	test('links back to login, shows the slogan and labelled fields', async ({ page }) => {
		await page.goto('/signup');
		await expect(h1(page)).toHaveText('Create an account');
		await expect(page.getByText(SLOGAN)).toBeVisible();
		await expect(page.getByText('Already have an account?')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
		await expect(page.getByLabel('Username')).toBeVisible();
		await expect(page.getByLabel('Password')).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'I am a' })).toBeVisible();
		await expect(page.getByLabel('Student')).toBeAttached();
		await expect(page.getByLabel('Employee')).toBeAttached();
		await expectNoOverflow(page);
	});

	test('the password meter says it in words, lists what is missing and is not colour only', async ({
		page
	}) => {
		await page.goto('/signup');
		const meter = page.getByTestId('password-meter');
		await expect(meter.getByText('At least 8 characters')).toBeVisible();
		await expect(meter.locator('[data-filled]')).toHaveAttribute('data-filled', '0');

		await page.getByLabel('Password').fill('abc');
		await expect(meter.getByText('Weak', { exact: true })).toBeVisible();
		await expect(meter.locator('[data-filled]')).toHaveAttribute('data-filled', '1');
		await expect(meter.locator('[data-filled] i')).toHaveCount(4);
		await expect(meter.getByText('An uppercase letter')).toBeVisible();
		await expect(meter.getByText('A digit')).toBeVisible();
		await expect(meter.getByText('A symbol')).toBeVisible();
		await expect(meter.getByText('A lowercase letter')).toHaveCount(0);

		await page.getByLabel('Password').fill('Abcdefg1');
		await expect(meter.getByText('Almost there', { exact: true })).toBeVisible();
		await expect(meter.getByText('A symbol')).toBeVisible();
		await expect(meter.getByText('A digit')).toHaveCount(0);

		await page.getByLabel('Password').fill('Abcdefg1!');
		await expect(meter.getByText('Strong', { exact: true })).toBeVisible();
		await expect(meter.locator('[data-filled]')).toHaveAttribute('data-filled', '4');
		await expect(meter.getByText('All rules met')).toBeVisible();
	});

	test('a taken username shows an inline error tied to the username field', async ({ page }) => {
		const { username } = await createUser(newName('taken'));
		await page.goto('/signup');
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(TEST_PASSWORD);
		await page.getByLabel('Student').check();
		await page.getByRole('button', { name: 'Sign up' }).click();
		await expect(page.getByRole('alert')).toHaveText('That username is taken.');
		const field = page.getByLabel('Username');
		await expect(field).toHaveAttribute('aria-invalid', 'true');
		expect(await describedBy(page, field)).toContain('That username is taken.');
		await expect(page.getByLabel('Student')).toBeChecked(); // choice survives
	});

	test('a weak password shows an inline error tied to the password field', async ({ page }) => {
		await page.goto('/signup');
		await page.getByLabel('Username').fill(newName('weak'));
		await page.getByLabel('Password').fill('abcdefgh');
		await page.getByLabel('Student').check();
		await page.getByRole('button', { name: 'Sign up' }).click();
		await expect(page.getByRole('alert')).toHaveText('Password does not meet the policy.');
		const field = page.getByLabel('Password');
		await expect(field).toHaveAttribute('aria-invalid', 'true');
		expect(await describedBy(page, field)).toContain('does not meet the policy');
	});

	test('the department is only needed, and only shown, for Employees', async ({ page }) => {
		const name = newName('emp');
		await page.goto('/signup');
		const dept = page.getByLabel('Department');
		await expect(dept).toBeHidden();
		await page.getByLabel('Student').check();
		await expect(dept).toBeHidden();
		await page.getByLabel('Employee').check();
		await expect(dept).toBeVisible();
		await expect(dept).toHaveJSProperty('required', true);
		await page.getByLabel('Student').check();
		await expect(dept).toBeHidden();
		await page.getByLabel('Employee').check();

		await page.getByLabel('Username').fill(name);
		await page.getByLabel('Password').fill(TEST_PASSWORD);
		await page.getByRole('button', { name: 'Sign up' }).click();
		await expect(page).toHaveURL(/\/signup$/); // blocked by the required department
		await dept.selectOption({ label: SSPD });
		await page.getByRole('button', { name: 'Sign up' }).click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/onboarding`);
		expect((await getUser(name)).department).toBe(SSPD);
	});

	test('dark mode text pairs keep AA contrast with the meter and an error showing', async ({
		page
	}) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/signup');
		await page.getByLabel('Password').fill('abc');
		await expect(page.getByTestId('password-meter').getByText('Weak')).toBeVisible();
		await page.getByLabel('Username').fill(newName('dk'));
		await page.getByLabel('Password').fill('abcdefgh');
		await page.getByLabel('Student').check();
		await page.getByRole('button', { name: 'Sign up' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `signup text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('an Employee can sign up: the department is always shown and works', async ({
			page
		}) => {
			const name = newName('nojsemp');
			await page.goto('/signup');
			const dept = page.getByLabel('Department');
			await expect(dept).toBeVisible();
			await expect(dept).toHaveJSProperty('required', false);
			await page.getByLabel('Username').fill(name);
			await page.getByLabel('Password').fill(TEST_PASSWORD);
			await page.getByLabel('Employee').check();
			await dept.selectOption({ label: SSPD });
			await page.getByRole('button', { name: 'Sign up' }).click();
			await expect(page).toHaveURL(`${E2E_ORIGIN}/onboarding`);
			expect((await getUser(name)).classification).toBe('Employee');
		});
	});
});

test.describe('reset password', () => {
	test('a bad token shows the generic message and no form', async ({ page }) => {
		await page.goto('/reset-password?token=nope');
		await expect(h1(page)).toHaveText('Reset your password');
		await expect(page.getByRole('alert')).toHaveText(
			'This reset link is invalid or expired. Ask an admin for a new one.'
		);
		await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Set new password' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Back to log in' })).toHaveAttribute(
			'href',
			'/login'
		);
		await expectNoOverflow(page);
	});

	test('a real token shows labelled fields and the meter; a mismatch is reported inline', async ({
		page
	}) => {
		const { username } = await createUser(newName('reset'));
		const admin = await getUser(ADMIN_USERNAME);
		const user = await getUser(username);
		const token = await createResetToken(db, admin.id, user.id);
		await page.goto(`/reset-password?token=${token}`);
		const pw = page.getByLabel('New password', { exact: true });
		const confirm = page.getByLabel('Confirm new password');
		await expect(pw).toBeVisible();
		await pw.fill('abc');
		await expect(page.getByTestId('password-meter').getByText('Weak', { exact: true })).toBeVisible();
		await pw.fill(NEW_PASSWORD);
		await confirm.fill('Different-Pass-1!');
		await page.getByRole('button', { name: 'Set new password' }).click();
		await expect(page.getByRole('alert')).toHaveText('Passwords do not match');
		await expect(confirm).toHaveAttribute('aria-invalid', 'true');
		expect(await describedBy(page, confirm)).toContain('Passwords do not match');
		await expectNoOverflow(page);
	});

	test('dark mode text pairs keep AA contrast', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/reset-password?token=nope');
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `reset text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
	});
});

test.describe('profile', () => {
	test('shows the identity, a Photo and a Password section, one h1', async ({ page }) => {
		await signedIn(page);
		await page.goto('/profile');
		await expect(h1(page)).toHaveCount(1);
		await expect(h1(page)).toHaveText('Profile');
		const main = page.getByRole('main');
		await expect(main.getByRole('heading', { level: 2, name: 'Photo' })).toBeVisible();
		await expect(main.getByRole('heading', { level: 2, name: 'Password' })).toBeVisible();
		await expect(main.getByText('Student', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Choose a photo')).toBeAttached();
		await expect(page.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
		await expectNoOverflow(page);
	});

	test('avatar: preview is a square, Save and Remove update the page and announce it', async ({
		page
	}) => {
		await signedIn(page);
		await page.goto('/profile');
		await page.locator('input[type=file]').setInputFiles({
			name: 'me.png',
			mimeType: 'image/png',
			buffer: await testImage(900, 600)
		});
		const preview = page.getByTestId('avatar-preview');
		await expect(preview).toBeVisible();
		const box = await preview.boundingBox();
		expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
		await page.getByRole('button', { name: 'Save photo' }).click();
		await expect(page.getByRole('status')).toHaveText('Photo updated.');
		await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
		await expect(page.getByTestId('avatar').locator('img')).toBeVisible();
		await page.getByRole('button', { name: 'Remove photo' }).click();
		await expect(page.getByRole('status')).toHaveText('Photo removed.');
		await expect(page.getByTestId('avatar')).toHaveCount(0);
	});

	test('a non-image shows an error in the live region', async ({ page }) => {
		await signedIn(page);
		await page.goto('/profile');
		await page.locator('input[type=file]').setInputFiles({
			name: 'notes.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('hello')
		});
		await expect(page.getByRole('status')).toContainText('Could not read that image');
		await expect(page.getByTestId('avatar-preview')).toHaveCount(0);
	});

	test('the file picker is a labelled control with a visible focus ring', async ({ page }) => {
		await signedIn(page);
		await page.goto('/profile');
		await page.keyboard.press('Tab'); // skip link
		const input = page.locator('input[type=file]');
		await input.focus();
		const ring = await page
			.getByText('Choose a photo')
			.evaluate((el) => getComputedStyle(el.closest('label')!).outlineStyle);
		expect(ring).not.toBe('none');
		const box = await page.getByText('Choose a photo').boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
	});

	test('change password: failures are inline and tied to the fields, success is announced', async ({
		page
	}) => {
		const { password } = await signedIn(page);
		await page.goto('/profile');
		const current = page.getByLabel('Current password');
		const next = page.getByLabel('New password', { exact: true });
		const confirm = page.getByLabel('Confirm new password');

		await current.fill('Wrong-Pass-1!');
		await next.fill(NEW_PASSWORD);
		await confirm.fill(NEW_PASSWORD);
		await page.getByRole('button', { name: 'Change password' }).click();
		await expect(page.getByRole('alert')).toContainText('Current password is incorrect');
		await expect(current).toHaveAttribute('aria-invalid', 'true');
		expect(await describedBy(page, current)).toContain('Current password is incorrect');

		await current.fill(password);
		await next.fill(NEW_PASSWORD);
		await confirm.fill('Different-Pass-1!');
		await page.getByRole('button', { name: 'Change password' }).click();
		await expect(page.getByRole('alert')).toContainText('do not match');
		await expect(confirm).toHaveAttribute('aria-invalid', 'true');

		await current.fill(password);
		await next.fill(NEW_PASSWORD);
		await confirm.fill(NEW_PASSWORD);
		await page.getByRole('button', { name: 'Change password' }).click();
		await expect(page.getByRole('status')).toHaveText(
			'Password changed. Other devices were signed out.'
		);
		await expect(page.getByRole('alert')).toHaveCount(0);
	});

	test('the new password shows the meter in words', async ({ page }) => {
		await signedIn(page);
		await page.goto('/profile');
		await page.getByLabel('New password', { exact: true }).fill('abc');
		await expect(
			page.getByTestId('password-meter').getByText('Weak', { exact: true })
		).toBeVisible();
	});

	test('Open admin is only offered to admins', async ({ page }) => {
		await signedIn(page);
		await page.goto('/profile');
		await expect(page.getByRole('link', { name: 'Open admin' })).toHaveCount(0);

		const adminPage = await page.context().browser()!.newContext({ viewport: PHONE });
		const p = await adminPage.newPage();
		await giveSession(adminPage, ADMIN_USERNAME, ADMIN_PASSWORD);
		await p.goto('/profile');
		await expect(p.getByRole('link', { name: 'Open admin' })).toHaveAttribute(
			'href',
			'/admin/review'
		);
		await adminPage.close();
	});

	test('Sign out ends the session', async ({ page }) => {
		await signedIn(page);
		await page.goto('/profile');
		const out = page.getByRole('main').getByRole('button', { name: 'Sign out' });
		const box = await out.boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
		await out.click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
		await page.goto('/profile');
		await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
	});

	test('desktop layout has no overflow', async ({ page }) => {
		await page.setViewportSize(LAPTOP);
		await signedIn(page);
		await page.goto('/profile');
		await expect(h1(page)).toHaveText('Profile');
		await expectNoOverflow(page);
	});

	test('dark mode text pairs keep AA contrast', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await signedIn(page);
		await page.goto('/profile');
		await page.getByLabel('New password', { exact: true }).fill('abc');
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `profile text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
	});
});

test.describe('error pages', () => {
	test('an unknown URL is a branded 404 with a way home', async ({ page }) => {
		await signedIn(page);
		const res = await page.goto('/no/such/page');
		expect(res?.status()).toBe(404);
		await expect(h1(page)).toHaveCount(1);
		await expect(h1(page)).toHaveText("This page doesn't exist");
		await expect(page.getByText('404', { exact: true })).toBeVisible();
		const home = page.getByRole('link', { name: 'Go home' });
		await expect(home).toHaveAttribute('href', '/');
		const box = await home.boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
		await expectNoOverflow(page);
		await home.click();
		await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
	});

	test('a non-admin on an admin URL gets a branded 403', async ({ page }) => {
		await signedIn(page);
		const res = await page.goto('/admin/users');
		expect(res?.status()).toBe(403);
		await expect(h1(page)).toHaveText("You don't have access to this page.");
		await expect(page.getByText('403', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
	});

	test('the 404 page follows dark mode and keeps contrast', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await signedIn(page);
		await page.goto('/no/such/page');
		const r = await lowestContrast(page, 'main');
		expect(r.ratio, `404 text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(bg).toBe('rgb(16, 22, 19)');
	});

	test('anonymous visitors are still sent to /login', async ({ page }) => {
		await page.goto('/no/such/page');
		await expect(page).toHaveURL(`${E2E_ORIGIN}/login`);
	});
});

test.describe('offline page', () => {
	const file = readFileSync(join(process.cwd(), 'static', 'offline', 'index.html'), 'utf8');

	test('is static, self-contained, small, and has a dark scheme block', () => {
		expect(file).not.toMatch(/<script/i);
		expect(file).not.toMatch(/https?:\/\//i);
		expect(file).not.toMatch(/@import|<link[^>]+stylesheet/i);
		expect(file).toMatch(/prefers-color-scheme:\s*dark/);
		expect(file).toMatch(/<meta name="color-scheme" content="light dark"/);
		expect(file.match(/<meta name="theme-color"/g)).toHaveLength(2);
		expect(file).toMatch(/<html lang="en"/);
		expect(file).toMatch(/name="viewport"/);
		expect(Buffer.byteLength(file)).toBeLessThan(4600);
		// Same-origin or relative references only.
		for (const [, v] of file.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
			expect(v, v).toMatch(/^(|\.\/|\/icons\/[\w./-]+)$/);
		}
		expect(file).toMatch(/<a [^>]*href="(\.\/)?"/); // "Try again" retries the page the user wanted
	});

	test.describe('rendered', () => {
		test.use({ javaScriptEnabled: false });

		for (const scheme of ['light', 'dark'] as const) {
			test(`renders without JS in ${scheme} mode with the token palette`, async ({ page }) => {
				await page.emulateMedia({ colorScheme: scheme });
				const external: string[] = [];
				page.on('request', (r) => {
					if (!r.url().startsWith(E2E_ORIGIN)) external.push(r.url());
				});
				await page.goto('/offline/index.html');
				await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
				await expect(page.getByText('needs a connection')).toBeVisible();
				await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
				const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
				expect(bg).toBe(scheme === 'dark' ? 'rgb(16, 22, 19)' : 'rgb(237, 240, 235)');
				const r = await lowestContrast(page, 'main');
				expect(r.ratio, `offline text "${r.text}"`).toBeGreaterThanOrEqual(4.5);
				const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
				expect(font).not.toMatch(/Times/i);
				await expectNoOverflow(page);
				expect(external).toEqual([]);
			});
		}
	});

	test('served by the service worker for another URL, Try again points back at that URL', async ({
		page,
		context
	}) => {
		await signedIn(page);
		await page.goto('/');
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.reload();
		await expect
			.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
			.toBe(true);
		await context.setOffline(true);
		try {
			await page.goto('/feed');
			await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
			const link = page.getByRole('link', { name: 'Try again' });
			expect(await link.evaluate((a: HTMLAnchorElement) => a.href)).toBe(`${E2E_ORIGIN}/feed`);
		} finally {
			await context.setOffline(false);
		}
	});
});
