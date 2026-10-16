import { randomBytes } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import { login, SESSION_COOKIE } from '../../src/lib/server/auth/session';
import { signUp as signUpService } from '../../src/lib/server/auth/users';
import { ADMIN_PASSWORD, ADMIN_USERNAME, E2E_ORIGIN, TEST_PASSWORD, e2eDatabaseUrl } from './env';

// Short idle timeout so the worker process can exit without an explicit close.
const client = postgres(e2eDatabaseUrl(), { max: 2, idle_timeout: 1, onnotice: () => {} });
/** Direct access to the e2e database, for arranging and inspecting state. */
export const db = drizzle(client, { schema });

/** A username that is unique per call, so tests never collide or need cleanup. */
export function uniqueUsername(prefix = 'e2e'): string {
	return `${prefix}-${randomBytes(4).toString('hex')}`;
}

/** Signs up through the UI as a Student; lands wherever the app sends a new user. */
export async function signUp(page: Page, username: string, password = TEST_PASSWORD): Promise<void> {
	await page.goto('/signup');
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByLabel('Student').check();
	await page.getByRole('button', { name: 'Sign up' }).click();
	await expect(page).not.toHaveURL(/\/signup/);
}

/**
 * Creates a user directly in the database (no sign-up rate limit, no UI), already onboarded
 * unless `onboarded: false`. Returns the credentials.
 */
export async function createUser(
	username = uniqueUsername(),
	{ onboarded = true }: { onboarded?: boolean } = {}
): Promise<{ username: string; password: string }> {
	const user = await signUpService(db, { username, password: TEST_PASSWORD, classification: 'Student' });
	if (onboarded) {
		await db.update(schema.users).set({ onboardingCompleted: true }).where(eq(schema.users.id, user.id));
	}
	return { username, password: TEST_PASSWORD };
}

/** Starts a real session in the database and gives the browser context its cookie. */
export async function giveSession(
	context: BrowserContext,
	username: string,
	password: string
): Promise<string> {
	const { sessionId } = await login(db, username, password);
	await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: E2E_ORIGIN }]);
	return sessionId;
}

/** Creates an onboarded user and signs the page's context in as them. */
export async function loginAsNewUser(page: Page): Promise<{ username: string; password: string }> {
	const creds = await createUser();
	await giveSession(page.context(), creds.username, creds.password);
	return creds;
}

export async function loginAsAdmin(page: Page): Promise<void> {
	await giveSession(page.context(), ADMIN_USERNAME, ADMIN_PASSWORD);
}

/** Deletes every session row of a user, as an expiry or remote logout would. */
export async function dropSessions(username: string): Promise<void> {
	const [u] = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(eq(schema.users.usernameNormalized, username.toLowerCase()));
	await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
}

export async function getUser(username: string) {
	const [u] = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.usernameNormalized, username.toLowerCase()));
	return u;
}
