import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import { resetRateLimits } from '../../src/lib/server/ratelimit';

let t: TestDb;
vi.mock('$lib/server/db', () => ({ getDb: () => t.db }));

let userId: number;

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	const [u] = await t.db
		.insert(users)
		.values({ usernameNormalized: 'api', displayUsername: 'api', passwordHash: 'x' })
		.returning();
	userId = u.id;
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	resetRateLimits();
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await createPeriod(t.db, 'Test');
});

async function post(key: string, authed = true) {
	const { POST } = await import('../../src/routes/api/tasks/[key]/+server');
	const res = await POST({
		locals: { user: authed ? { id: userId } : null },
		params: { key }
	} as unknown as Parameters<typeof POST>[0]);
	return { status: res.status, body: await res.json() };
}

describe('POST /api/tasks/[key]', () => {
	it('requires login', async () => {
		expect((await post('dishwasher', false)).status).toBe(401);
	});

	it('credits a self-reported task and reports the new total', async () => {
		const r = await post('dishwasher');
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ ok: true, pointsAwarded: 2, newTotal: 2 });
	});

	it('refuses photo tasks without creating a submission', async () => {
		for (const key of ['cutlery', 'beans', 'grounds']) {
			const r = await post(key);
			expect(r.status).toBe(422);
			expect(r.body).toEqual({ error: 'photo_required' });
		}
		expect(await t.db.select().from(submissions)).toHaveLength(0);
	});

	it('404s on unknown tasks', async () => {
		expect((await post('nope')).status).toBe(404);
	});
});
