import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import {
	events,
	periodWinners,
	periods,
	submissions,
	users
} from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { getLeaderboard } from '../../src/lib/server/leaderboard';
import {
	PeriodNotActiveError,
	createPeriod,
	endPeriod,
	listPastPeriods
} from '../../src/lib/server/periods';
import { NoActivePeriodError, logTask } from '../../src/lib/server/tasks';

const SSPD = 'Software Systems Programming and Development';
const IRG = 'Interactions Research Group';

let t: TestDb;
let periodId: number;

async function mkUser(
	name: string,
	opts: {
		classification?: 'Student' | 'Employee';
		department?: typeof SSPD | typeof IRG;
		active?: boolean;
	} = {}
) {
	const [row] = await t.db
		.insert(users)
		.values({
			usernameNormalized: name,
			displayUsername: name,
			passwordHash: 'x',
			classification: opts.classification ?? 'Student',
			department: opts.department ?? null,
			active: opts.active ?? true
		})
		.returning();
	return row.id;
}

async function award(
	userId: number,
	points: number,
	opts: { status?: 'pending' | 'approved' | 'rejected'; period?: number } = {}
) {
	await t.db.insert(submissions).values({
		userId,
		taskKey: 'dishwasher',
		periodId: opts.period ?? periodId,
		status: opts.status ?? 'approved',
		pointsAwarded: points
	});
}

async function reset() {
	await t.db.delete(periodWinners);
	await t.db.delete(events);
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await t.db.delete(users);
}

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	await reset();
	periodId = (await createPeriod(t.db, 'Test')).id;
});

describe('getLeaderboard', () => {
	it('counts only approved points and omits zero-point users', async () => {
		const a = await mkUser('alice');
		const b = await mkUser('bob');
		await mkUser('carol');
		await award(a, 5);
		await award(a, 7, { status: 'pending' });
		await award(a, 9, { status: 'rejected' });
		await award(b, 7, { status: 'pending' });
		const board = await getLeaderboard(t.db, periodId);
		expect(board).toEqual([
			{
				userId: a,
				username: 'alice',
				avatar: null,
				classification: 'Student',
				department: null,
				points: 5,
				rank: 1
			}
		]);
	});

	it('filters by department and by classification', async () => {
		const s = await mkUser('stu', { classification: 'Student' });
		const e1 = await mkUser('emp1', { classification: 'Employee', department: SSPD });
		const e2 = await mkUser('emp2', { classification: 'Employee', department: IRG });
		await award(s, 10);
		await award(e1, 8);
		await award(e2, 6);
		const dept = await getLeaderboard(t.db, periodId, { department: IRG });
		expect(dept.map((r) => r.username)).toEqual(['emp2']);
		expect(dept[0].rank).toBe(1);
		const emps = await getLeaderboard(t.db, periodId, { classification: 'Employee' });
		expect(emps.map((r) => r.username)).toEqual(['emp1', 'emp2']);
		const studs = await getLeaderboard(t.db, periodId, { classification: 'Student' });
		expect(studs.map((r) => r.username)).toEqual(['stu']);
	});

	it('ties share a rank and the next rank skips', async () => {
		const a = await mkUser('amy');
		const b = await mkUser('ben');
		const c = await mkUser('cat');
		await award(a, 10);
		await award(b, 10);
		await award(c, 4);
		const board = await getLeaderboard(t.db, periodId);
		expect(board.map((r) => [r.username, r.rank])).toEqual([
			['amy', 1],
			['ben', 1],
			['cat', 3]
		]);
	});

	it('hides deactivated users in both active and ended periods', async () => {
		const a = await mkUser('alive');
		const g = await mkUser('gone', { active: false });
		await award(a, 3);
		await award(g, 9);
		expect((await getLeaderboard(t.db, periodId)).map((r) => r.username)).toEqual(['alive']);
		await endPeriod(t.db, periodId);
		expect((await getLeaderboard(t.db, periodId)).map((r) => r.username)).toEqual(['alive']);
	});

	it('leaves an ended period unchanged by submissions in other periods', async () => {
		const a = await mkUser('amy');
		await award(a, 5);
		await endPeriod(t.db, periodId);
		const before = await getLeaderboard(t.db, periodId);
		const next = await createPeriod(t.db, 'Next');
		await award(a, 50, { period: next.id });
		expect(await getLeaderboard(t.db, periodId)).toEqual(before);
	});
});

describe('endPeriod', () => {
	it('records every tied top user as a winner and ends the period', async () => {
		const a = await mkUser('amy');
		const b = await mkUser('ben');
		const c = await mkUser('cat');
		await award(a, 10);
		await award(b, 10);
		await award(c, 4);
		const winners = await endPeriod(t.db, periodId);
		expect(winners.map((w) => [w.userId, w.points, w.rank]).sort()).toEqual(
			[
				[a, 10, 1],
				[b, 10, 1]
			].sort()
		);
		const [p] = await t.db.select().from(periods).where(eq(periods.id, periodId));
		expect(p.status).toBe('ended');
		expect(p.endsAt).not.toBeNull();
		expect(await t.db.select().from(periodWinners)).toHaveLength(2);
	});

	it('never makes a deactivated top scorer the winner; winners match the live board', async () => {
		const a = await mkUser('top');
		const b = await mkUser('next');
		await award(a, 20);
		await award(b, 8);
		await t.db.update(users).set({ active: false }).where(eq(users.id, a));
		const board = await getLeaderboard(t.db, periodId);
		const winners = await endPeriod(t.db, periodId);
		expect(winners.map((w) => [w.userId, w.points])).toEqual([[b, 8]]);
		expect(board.filter((r) => r.rank === 1).map((r) => r.userId)).toEqual([b]);
	});

	it('throws when the period is already ended', async () => {
		await endPeriod(t.db, periodId);
		await expect(endPeriod(t.db, periodId)).rejects.toBeInstanceOf(PeriodNotActiveError);
	});

	it('ends with no winners when nobody has points', async () => {
		await mkUser('amy');
		expect(await endPeriod(t.db, periodId)).toEqual([]);
		const [p] = await t.db.select().from(periods).where(eq(periods.id, periodId));
		expect(p.status).toBe('ended');
		expect(await t.db.select().from(periodWinners)).toEqual([]);
	});

	it('serialises with an in-flight logTask: winners always match the final standings', async () => {
		for (let i = 0; i < 8; i++) {
			await reset();
			const p = await createPeriod(t.db, `Race ${i}`);
			const u = await mkUser(`racer${i}`);
			const [logged, ended] = await Promise.allSettled([
				logTask(t.db, u, 'dishwasher'),
				endPeriod(t.db, p.id)
			]);
			expect(ended.status).toBe('fulfilled');
			if (logged.status === 'rejected') {
				expect(logged.reason).toBeInstanceOf(NoActivePeriodError);
			}
			const board = await getLeaderboard(t.db, p.id);
			const finalTotal = board.reduce((s, r) => s + r.points, 0);
			const won = await t.db.select().from(periodWinners).where(eq(periodWinners.periodId, p.id));
			expect(won.reduce((s, w) => s + w.points, 0)).toBe(finalTotal);
			expect(won.length).toBe(board.length);
		}
	});
});

describe('listPastPeriods', () => {
	it('keeps a recorded winner in history after the user is deactivated', async () => {
		const a = await mkUser('champ');
		const b = await mkUser('other');
		await award(a, 10);
		await award(b, 4);
		await endPeriod(t.db, periodId);
		await t.db.update(users).set({ active: false }).where(eq(users.id, a));
		const [p] = await listPastPeriods(t.db);
		expect(p.winners).toEqual([{ userId: a, username: 'champ', points: 10, avatarPath: null }]);
		expect(p.participants).toBe(1);
	});

	it('lists ended periods newest first with winners and participant counts', async () => {
		const a = await mkUser('amy');
		const b = await mkUser('ben');
		await award(a, 10);
		await award(b, 4);
		await endPeriod(t.db, periodId);
		const second = await createPeriod(t.db, 'Second');
		await award(b, 2, { period: second.id });
		await endPeriod(t.db, second.id);
		await createPeriod(t.db, 'Active one');
		const past = await listPastPeriods(t.db);
		expect(past.map((p) => p.name)).toEqual(['Second', 'Test']);
		expect(past[0].participants).toBe(1);
		expect(past[0].winners).toEqual([{ userId: b, username: 'ben', points: 2, avatarPath: null }]);
		expect(past[1].participants).toBe(2);
		expect(past[1].winners).toEqual([{ userId: a, username: 'amy', points: 10, avatarPath: null }]);
	});
});
