import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, periodWinners, periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import { getUserStanding, listRecentActivity } from '../../src/lib/server/standing';

let t: TestDb;
let periodId: number;

async function mkUser(name: string, active = true) {
	const [row] = await t.db
		.insert(users)
		.values({
			usernameNormalized: name,
			displayUsername: name,
			passwordHash: 'x',
			classification: 'Student',
			active
		})
		.returning();
	return row.id;
}

async function award(
	userId: number,
	points: number,
	opts: {
		status?: 'pending' | 'approved' | 'rejected';
		at?: Date;
		task?: string;
		period?: number;
	} = {}
) {
	await t.db.insert(submissions).values({
		userId,
		taskKey: opts.task ?? 'dishwasher',
		periodId: opts.period ?? periodId,
		status: opts.status ?? 'approved',
		pointsAwarded: points,
		createdAt: opts.at ?? new Date()
	});
}

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	await t.db.delete(periodWinners);
	await t.db.delete(events);
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await t.db.delete(users);
	periodId = (await createPeriod(t.db, 'Test')).id;
});

describe('getUserStanding', () => {
	it('ranks with ties sharing a rank (1,1,3) and reports the gap to first', async () => {
		const a = await mkUser('a');
		const b = await mkUser('b');
		const c = await mkUser('c');
		await award(a, 10);
		await award(b, 10);
		await award(c, 4);
		expect(await getUserStanding(t.db, a, periodId)).toEqual({
			points: 10,
			rank: 1,
			ofTotal: 3,
			behindFirst: 0,
			leaders: 2
		});
		expect(await getUserStanding(t.db, b, periodId)).toEqual({
			points: 10,
			rank: 1,
			ofTotal: 3,
			behindFirst: 0,
			leaders: 2
		});
		expect(await getUserStanding(t.db, c, periodId)).toEqual({
			points: 4,
			rank: 3,
			ofTotal: 3,
			behindFirst: 6,
			leaders: 2
		});
	});

	it('gives a user with no approved points rank null and the first place points as the gap', async () => {
		const a = await mkUser('a');
		const z = await mkUser('z');
		await award(a, 7);
		await award(z, 5, { status: 'pending' });
		await award(z, 5, { status: 'rejected' });
		expect(await getUserStanding(t.db, z, periodId)).toEqual({
			points: 0,
			rank: null,
			ofTotal: 1,
			behindFirst: 7,
			leaders: 1
		});
	});

	it('excludes deactivated users from ranks and the board size', async () => {
		const gone = await mkUser('gone', false);
		const a = await mkUser('a');
		const b = await mkUser('b');
		await award(gone, 50);
		await award(a, 10);
		await award(b, 6);
		expect(await getUserStanding(t.db, b, periodId)).toEqual({
			points: 6,
			rank: 2,
			ofTotal: 2,
			behindFirst: 4,
			leaders: 1
		});
	});

	it('handles an empty period', async () => {
		const z = await mkUser('z');
		expect(await getUserStanding(t.db, z, periodId)).toEqual({
			points: 0,
			rank: null,
			ofTotal: 0,
			behindFirst: 0,
			leaders: 0
		});
	});

	it('ignores other periods', async () => {
		const a = await mkUser('a');
		await award(a, 9);
		await t.db.update(periods).set({ status: 'ended', endsAt: new Date() });
		const next = (await createPeriod(t.db, 'Next')).id;
		expect((await getUserStanding(t.db, a, next)).points).toBe(0);
	});
});

describe('listRecentActivity', () => {
	it('returns approved entries only, newest first, without deactivated users', async () => {
		const a = await mkUser('alice');
		const gone = await mkUser('gone', false);
		const now = Date.now();
		await award(a, 2, { at: new Date(now - 3000), task: 'dishwasher' });
		await award(a, 3, { at: new Date(now - 1000), task: 'grounds' });
		await award(a, 0, { at: new Date(now - 500), status: 'pending', task: 'beans' });
		await award(a, 0, { at: new Date(now - 400), status: 'rejected', task: 'milk' });
		await award(gone, 2, { at: new Date(now - 200), task: 'dishwasher' });
		const rows = await listRecentActivity(t.db, periodId);
		expect(rows.map((r) => [r.username, r.taskKey])).toEqual([
			['alice', 'grounds'],
			['alice', 'dishwasher']
		]);
		expect(rows[0].taskLabel).toBe('Take coffee grounds to 2nd basement');
		expect(rows[0].at).toBeInstanceOf(Date);
		expect(Object.keys(rows[0]).sort()).toEqual(['at', 'id', 'taskKey', 'taskLabel', 'username']);
	});

	it('caps at the limit (default 8)', async () => {
		const a = await mkUser('alice');
		for (let i = 0; i < 12; i++) await award(a, 1, { at: new Date(Date.now() - i * 1000) });
		expect(await listRecentActivity(t.db, periodId)).toHaveLength(8);
		expect(await listRecentActivity(t.db, periodId, 3)).toHaveLength(3);
	});

	it('is empty for an empty period and ignores other periods', async () => {
		expect(await listRecentActivity(t.db, periodId)).toEqual([]);
		expect(await listRecentActivity(t.db, periodId + 99)).toEqual([]);
	});
});
