import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { ne } from 'drizzle-orm';
import { periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import { ACTIVITY_PAGE_SIZE, listPeriodActivity } from '../../src/lib/server/activity';
import { logTask } from '../../src/lib/server/tasks';
import { revokeSubmission } from '../../src/lib/server/revoke';

let t: TestDb;
let admin: number;
let periodId: number;

async function mkUser(name: string, role: 'user' | 'admin' = 'user') {
	const [row] = await t.db
		.insert(users)
		.values({ usernameNormalized: name.toLowerCase(), displayUsername: name, passwordHash: 'x', role })
		.returning();
	return row.id;
}

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	admin = await mkUser('Boss', 'admin');
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await t.db.delete(users).where(ne(users.id, admin));
	periodId = (await createPeriod(t.db, 'P')).id;
});

describe('listPeriodActivity', () => {
	it('lists approved chores newest first with the person and chore', async () => {
		const a = await mkUser('Amy');
		const s1 = await logTask(t.db, a, 'dishwasher', { now: new Date('2026-10-16T10:00:00Z') });
		const s2 = await logTask(t.db, a, 'cutlery', { now: new Date('2026-10-16T11:00:00Z') });
		const { items, next } = await listPeriodActivity(t.db, periodId);
		expect(next).toBeNull();
		expect(items.map((i) => i.id)).toEqual([s2.id, s1.id]);
		expect(items[0]).toMatchObject({ username: 'Amy', taskKey: 'cutlery', points: 1, status: 'approved' });
	});

	it('hides removed chores unless asked, and says who removed them', async () => {
		const a = await mkUser('Amy');
		const s = await logTask(t.db, a, 'dishwasher');
		await revokeSubmission(t.db, admin, s.id, 'oops');
		expect((await listPeriodActivity(t.db, periodId)).items).toHaveLength(0);
		const { items } = await listPeriodActivity(t.db, periodId, { includeRemoved: true });
		expect(items[0]).toMatchObject({
			status: 'revoked',
			revokedByUsername: 'Boss',
			revokeReason: 'oops'
		});
	});

	it('filters by person (case-insensitive, wildcards literal) and chore', async () => {
		const a = await mkUser('Amy');
		const b = await mkUser('bo_b');
		await logTask(t.db, a, 'dishwasher');
		await logTask(t.db, b, 'cutlery');
		const names = async (f: Parameters<typeof listPeriodActivity>[2]) =>
			(await listPeriodActivity(t.db, periodId, f)).items.map((i) => i.username);
		expect(await names({ user: 'AM' })).toEqual(['Amy']);
		expect(await names({ user: '%' })).toEqual([]);
		expect(await names({ user: 'bo_' })).toEqual(['bo_b']);
		expect(await names({ user: 'b_b' })).toEqual([]);
		expect(await names({ taskKey: 'cutlery' })).toEqual(['bo_b']);
	});

	it('only shows the given period, and pages with a cursor', async () => {
		const a = await mkUser('Amy');
		for (let i = 0; i < ACTIVITY_PAGE_SIZE + 3; i++) {
			await t.db.insert(submissions).values({
				userId: a,
				taskKey: 'cutlery',
				periodId,
				status: 'approved',
				pointsAwarded: 1
			});
		}
		const first = await listPeriodActivity(t.db, periodId);
		expect(first.items).toHaveLength(ACTIVITY_PAGE_SIZE);
		const second = await listPeriodActivity(t.db, periodId, { beforeId: first.next! });
		expect(second.items).toHaveLength(3);
		expect(second.next).toBeNull();
		expect((await listPeriodActivity(t.db, periodId + 99)).items).toHaveLength(0);
	});
});
