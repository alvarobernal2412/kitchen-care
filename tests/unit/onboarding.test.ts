import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { users } from '../../src/lib/server/db/schema';
import { signUp } from '../../src/lib/server/auth/users';
import { completeOnboarding } from '../../src/lib/server/onboarding';
import { needsOnboarding, usesShell } from '../../src/lib/onboarding';

describe('usesShell', () => {
	it('hides the shell on the onboarding flow only', () => {
		expect(usesShell('/onboarding')).toBe(false);
		expect(usesShell('/onboarding/')).toBe(false);
		expect(usesShell('/')).toBe(true);
		expect(usesShell('/profile')).toBe(true);
		expect(usesShell('/onboardingx')).toBe(true);
	});
});

describe('needsOnboarding', () => {
	const fresh = { onboardingCompleted: false };
	const done = { onboardingCompleted: true };

	it('sends users who have not onboarded to /onboarding', () => {
		expect(needsOnboarding(fresh, '/')).toBe(true);
		expect(needsOnboarding(fresh, '/feed')).toBe(true);
		expect(needsOnboarding(fresh, '/admin/users')).toBe(true);
		expect(needsOnboarding(fresh, '/profile')).toBe(true);
	});

	it('never redirects away from /onboarding itself', () => {
		expect(needsOnboarding(fresh, '/onboarding')).toBe(false);
		expect(needsOnboarding(fresh, '/onboarding/')).toBe(false);
	});

	it('never redirects logout, api or media', () => {
		expect(needsOnboarding(fresh, '/logout')).toBe(false);
		expect(needsOnboarding(fresh, '/api/avatar')).toBe(false);
		expect(needsOnboarding(fresh, '/media/x.webp')).toBe(false);
	});

	it('does not treat look-alike prefixes as exempt', () => {
		expect(needsOnboarding(fresh, '/onboardingx')).toBe(true);
		expect(needsOnboarding(fresh, '/apix')).toBe(true);
		expect(needsOnboarding(fresh, '/media-x')).toBe(true);
	});

	it('never redirects users whose DB flag is true', () => {
		expect(needsOnboarding(done, '/')).toBe(false);
		expect(needsOnboarding(done, '/feed')).toBe(false);
	});
});

describe('completeOnboarding', () => {
	let t: TestDb;
	beforeAll(async () => {
		t = await getTestDb();
	});
	afterAll(async () => {
		await t.close();
	});

	it('sets the flag and is idempotent', async () => {
		const u = await signUp(t.db, {
			username: 'onboarder',
			password: 'Abcdef1!',
			classification: 'Student'
		});
		expect(u.onboardingCompleted).toBe(false);
		await completeOnboarding(t.db, u.id);
		await completeOnboarding(t.db, u.id);
		const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
		expect(row.onboardingCompleted).toBe(true);
	});

	it('only touches the given user', async () => {
		const a = await signUp(t.db, { username: 'usera', password: 'Abcdef1!', classification: 'Student' });
		const b = await signUp(t.db, { username: 'userb', password: 'Abcdef1!', classification: 'Student' });
		await completeOnboarding(t.db, a.id);
		const [rowB] = await t.db.select().from(users).where(eq(users.id, b.id));
		expect(rowB.onboardingCompleted).toBe(false);
	});
});
