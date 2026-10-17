import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { submissions, users } from '../../src/lib/server/db/schema';
import { signUp } from '../../src/lib/server/auth/users';
import { resetRateLimits } from '../../src/lib/server/ratelimit';
import { getLeaderboard } from '../../src/lib/server/leaderboard';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';

let t: TestDb;
vi.mock('$lib/server/db', () => ({ getDb: () => t.db }));

const PW = 'Abcdef1!';
let me: { id: number; active: boolean };
let periodId: number;

beforeAll(async () => {
	t = await getTestDb();
	const u = await signUp(t.db, { username: 'pa-me', password: PW, classification: 'Student' });
	me = { id: u.id, active: true };
	await seedTasks(t.db);
	periodId = (await createPeriod(t.db, 'Test')).id;
	await signUp(t.db, { username: 'Pa-Taken', password: PW, classification: 'Student' });
});
afterAll(async () => {
	await t.close();
});
beforeEach(() => resetRateLimits());

type Result = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;
async function run(fields: Record<string, string>, user: unknown = me): Promise<Result> {
	const { actions } = await import('../../src/routes/(app)/profile/+page.server');
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	const request = new Request('http://localhost/profile?/username', { method: 'POST', body });
	return (await (actions.username as (e: unknown) => Promise<unknown>)({
		request,
		locals: { user }
	})) as Result;
}

describe('profile ?/username action', () => {
	it('401 when signed out', async () => {
		expect((await run({}, null)).status).toBe(401);
	});

	it('validates presence of both fields', async () => {
		const noName = await run({ username: '   ', currentPassword: PW });
		expect(noName.status).toBe(400);
		expect(noName.data).toMatchObject({ usernameError: 'Enter a username.', usernameField: 'username' });
		const noPw = await run({ username: 'pa-new', currentPassword: '' });
		expect(noPw.data).toMatchObject({
			usernameError: 'Enter your current password.',
			usernameField: 'password',
			username: 'pa-new'
		});
	});

	it('reports a wrong password without echoing it', async () => {
		const r = await run({ username: 'pa-new', currentPassword: 'Nope1234!' });
		expect(r.status).toBe(400);
		expect(r.data).toMatchObject({
			usernameError: 'Current password is incorrect.',
			usernameField: 'password'
		});
		expect(JSON.stringify(r)).not.toContain('Nope1234!');
	});

	it('reports invalid and taken names on the username field', async () => {
		const bad = await run({ username: 'a b', currentPassword: PW });
		expect(bad.data).toMatchObject({ usernameField: 'username' });
		expect(String(bad.data?.usernameError)).toMatch(/3-32 characters/);
		const taken = await run({ username: 'pa-taken', currentPassword: PW });
		expect(taken.data).toMatchObject({
			usernameError: 'That username is taken.',
			usernameField: 'username',
			username: 'pa-taken'
		});
	});

	it('rate limits to 5 attempts per hour per user', async () => {
		for (let i = 0; i < 5; i++) await run({ username: 'pa-new', currentPassword: 'wrong-pass' });
		const r = await run({ username: 'pa-new', currentPassword: PW });
		expect(r.status).toBe(429);
		expect(r.data?.usernameError).toBe('Too many attempts. Try again in a few minutes.');
	});

	it('succeeds, and the leaderboard shows the new name', async () => {
		const redirected = await run({ username: ' Pa-Renamed ', currentPassword: PW }).catch((e) => e);
		expect(redirected).toMatchObject({ status: 303, location: '/profile?renamed=1' });
		const [row] = await t.db.select().from(users).where(eq(users.id, me.id));
		expect(row.displayUsername).toBe('Pa-Renamed');
		await t.db
			.insert(submissions)
			.values({ userId: me.id, taskKey: 'dishwasher', periodId, status: 'approved', pointsAwarded: 3 });
		const board = await getLeaderboard(t.db, periodId);
		expect(board.map((b) => b.username)).toContain('Pa-Renamed');
		expect(board.map((b) => b.username)).not.toContain('pa-me');
	});
});
