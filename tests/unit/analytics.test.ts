import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import {
	InvalidRangeError,
	getActivity,
	getHeatmap,
	getRangeTotals,
	getTaskDistribution,
	getTopContributors,
	resolveTimezone
} from '../../src/lib/server/analytics';

let t: TestDb;
let u1: number;
let u2: number;

const D = (s: string) => new Date(s);

async function mkUser(name: string, active = true) {
	const [r] = await t.db
		.insert(users)
		.values({ usernameNormalized: name, displayUsername: name, passwordHash: 'x', active })
		.returning();
	return r.id;
}
const ev = (userId: number | null, type: string, at: string) =>
	t.db.insert(events).values({ userId, type, createdAt: D(at) });

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	u1 = await mkUser('alice');
	u2 = await mkUser('bob');
});
afterAll(async () => t.close());
beforeEach(async () => {
	await t.db.delete(events);
	await t.db.delete(submissions);
	await t.db.delete(periods);
});

describe('resolveTimezone', () => {
	it('accepts valid IANA names, falls back to UTC otherwise', () => {
		expect(resolveTimezone('Europe/Madrid')).toBe('Europe/Madrid');
		expect(resolveTimezone(undefined)).toBe('UTC');
		expect(resolveTimezone('')).toBe('UTC');
		expect(resolveTimezone('Not/AZone')).toBe('UTC');
		expect(resolveTimezone("UTC'; drop table x;--")).toBe('UTC');
	});
});

describe('getActivity', () => {
	const range = (from: string, to: string, bucket: 'day' | 'week' = 'day', tz?: string) => ({
		from: D(from),
		to: D(to),
		bucket,
		tz
	});

	it('zero-fills empty buckets and counts opens, distinct users and submissions', async () => {
		await ev(u1, 'app_open', '2026-10-12T08:00:00Z');
		await ev(u1, 'app_open', '2026-10-12T09:00:00Z');
		await ev(u2, 'task_submitted', '2026-10-12T10:00:00Z');
		await ev(u1, 'task_submitted', '2026-10-14T10:00:00Z');
		const res = await getActivity(t.db, range('2026-10-12T00:00:00Z', '2026-10-15T00:00:00Z'));
		expect(res).toEqual([
			{ bucket: '2026-10-12', opens: 2, activeUsers: 2, submissions: 1 },
			{ bucket: '2026-10-13', opens: 0, activeUsers: 0, submissions: 0 },
			{ bucket: '2026-10-14', opens: 0, activeUsers: 1, submissions: 1 }
		]);
	});

	it('returns all zero buckets for an empty database', async () => {
		const res = await getActivity(t.db, range('2026-10-12T00:00:00Z', '2026-10-14T00:00:00Z'));
		expect(res.map((r) => r.bucket)).toEqual(['2026-10-12', '2026-10-13']);
		expect(res.every((r) => r.opens + r.activeUsers + r.submissions === 0)).toBe(true);
	});

	it('treats from as inclusive and to as exclusive', async () => {
		await ev(u1, 'app_open', '2026-10-12T00:00:00Z');
		await ev(u1, 'app_open', '2026-10-13T00:00:00Z'); // == to, excluded
		const res = await getActivity(t.db, range('2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z'));
		expect(res).toEqual([{ bucket: '2026-10-12', opens: 1, activeUsers: 1, submissions: 0 }]);
	});

	it('week buckets start on Monday', async () => {
		// 2026-10-11 is a Sunday, 2026-10-12 a Monday
		await ev(u1, 'app_open', '2026-10-11T12:00:00Z');
		await ev(u1, 'app_open', '2026-10-12T12:00:00Z');
		await ev(u2, 'app_open', '2026-10-18T12:00:00Z'); // Sunday of the same week
		const res = await getActivity(
			t.db,
			range('2026-10-11T00:00:00Z', '2026-10-19T00:00:00Z', 'week')
		);
		expect(res.map((r) => [r.bucket, r.opens, r.activeUsers])).toEqual([
			['2026-10-05', 1, 1],
			['2026-10-12', 2, 2]
		]);
	});

	it('buckets by the requested timezone', async () => {
		// 23:30Z on the 12th is already the 13th in Madrid (UTC+2)
		await ev(u1, 'app_open', '2026-10-12T23:30:00Z');
		const r = range('2026-10-12T00:00:00Z', '2026-10-14T00:00:00Z');
		const utc = await getActivity(t.db, { ...r, tz: 'UTC' });
		const mad = await getActivity(t.db, { ...r, tz: 'Europe/Madrid' });
		expect(utc.find((x) => x.opens === 1)?.bucket).toBe('2026-10-12');
		expect(mad.find((x) => x.opens === 1)?.bucket).toBe('2026-10-13');
	});

	it('handles the autumn DST change (25 hour day) without gaps or duplicates', async () => {
		// Madrid leaves DST on Sun 2026-10-25 at 03:00 local
		await ev(u1, 'app_open', '2026-10-24T22:30:00Z'); // Sun 00:30 CEST
		await ev(u2, 'app_open', '2026-10-25T22:30:00Z'); // Sun 23:30 CET (same local day)
		await ev(u1, 'app_open', '2026-10-25T23:30:00Z'); // Mon 00:30 CET
		const res = await getActivity(
			t.db,
			range('2026-10-23T22:00:00Z', '2026-10-27T22:00:00Z', 'day', 'Europe/Madrid')
		);
		expect(res.map((r) => [r.bucket, r.opens])).toEqual([
			['2026-10-24', 0],
			['2026-10-25', 2],
			['2026-10-26', 1],
			['2026-10-27', 0]
		]);
		const utc = await getActivity(t.db, range('2026-10-24T00:00:00Z', '2026-10-27T00:00:00Z'));
		expect(utc.map((r) => [r.bucket, r.opens])).toEqual([
			['2026-10-24', 1],
			['2026-10-25', 2],
			['2026-10-26', 0]
		]);
	});

	it('week buckets across DST respect the local Monday', async () => {
		await ev(u1, 'app_open', '2026-10-25T22:30:00Z'); // Sun 23:30 CET
		await ev(u1, 'app_open', '2026-10-25T23:30:00Z'); // Mon 00:30 CET
		const res = await getActivity(
			t.db,
			range('2026-10-19T00:00:00Z', '2026-11-01T00:00:00Z', 'week', 'Europe/Madrid')
		);
		expect(res.map((r) => [r.bucket, r.opens])).toEqual([
			['2026-10-19', 1],
			['2026-10-26', 1]
		]);
	});

	it('counts events without a user as opens but not as active users', async () => {
		await ev(null, 'app_open', '2026-10-12T08:00:00Z');
		const [row] = await getActivity(t.db, range('2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z'));
		expect(row.opens).toBe(1);
		expect(row.activeUsers).toBe(0);
	});

	it('rejects invalid ranges', async () => {
		const bad = (r: Parameters<typeof getActivity>[1]) =>
			expect(getActivity(t.db, r)).rejects.toBeInstanceOf(InvalidRangeError);
		await bad(range('2026-10-13T00:00:00Z', '2026-10-12T00:00:00Z'));
		await bad(range('2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z'));
		await bad(range('2025-01-01T00:00:00Z', '2026-10-12T00:00:00Z')); // > 400 days
		await bad({ from: new Date(NaN), to: D('2026-10-12T00:00:00Z'), bucket: 'day' });
		await bad({
			...range('2026-10-01T00:00:00Z', '2026-10-12T00:00:00Z'),
			bucket: 'month' as 'day'
		});
	});

	it('accepts exactly 400 days', async () => {
		const from = D('2025-09-01T00:00:00Z');
		const to = new Date(from.getTime() + 400 * 86_400_000);
		const res = await getActivity(t.db, { from, to, bucket: 'day' });
		expect(res).toHaveLength(400);
	});
});

describe('getRangeTotals', () => {
	it('counts distinct users over the whole range, not per bucket', async () => {
		await ev(u1, 'app_open', '2026-10-12T08:00:00Z');
		await ev(u1, 'app_open', '2026-10-13T08:00:00Z'); // same user on another day
		await ev(u2, 'task_submitted', '2026-10-13T09:00:00Z');
		await ev(u2, 'app_open', '2026-10-20T09:00:00Z'); // outside
		const res = await getRangeTotals(t.db, {
			from: D('2026-10-12T00:00:00Z'),
			to: D('2026-10-14T00:00:00Z')
		});
		expect(res).toEqual({ opens: 2, activeUsers: 2, submissions: 1 });
	});

	it('is all zeros for an empty range and rejects invalid ones', async () => {
		const from = D('2026-10-12T00:00:00Z');
		const to = D('2026-10-14T00:00:00Z');
		expect(await getRangeTotals(t.db, { from, to })).toEqual({
			opens: 0,
			activeUsers: 0,
			submissions: 0
		});
		await expect(getRangeTotals(t.db, { from: to, to: from })).rejects.toBeInstanceOf(
			InvalidRangeError
		);
	});
});

describe('getHeatmap', () => {
	const r = { from: D('2026-10-01T00:00:00Z'), to: D('2026-11-01T00:00:00Z') };

	it('has the full 7x24 shape of zeros when empty', async () => {
		const m = await getHeatmap(t.db, r);
		expect(m).toHaveLength(7);
		expect(m.every((row) => row.length === 24 && row.every((n) => n === 0))).toBe(true);
	});

	it('places three Tuesday 10:xx submissions in cell [1][10]', async () => {
		// 2026-10-13 is a Tuesday
		await ev(u1, 'task_submitted', '2026-10-13T10:05:00Z');
		await ev(u2, 'task_submitted', '2026-10-13T10:30:00Z');
		await ev(u1, 'task_submitted', '2026-10-20T10:59:00Z');
		await ev(u1, 'app_open', '2026-10-13T10:10:00Z'); // not a submission
		const m = await getHeatmap(t.db, r);
		expect(m[1][10]).toBe(3);
		expect(m.flat().reduce((a, b) => a + b, 0)).toBe(3);
	});

	it('respects the timezone (weekday and hour shift)', async () => {
		await ev(u1, 'task_submitted', '2026-10-13T10:05:00Z'); // Madrid Tue 12:05
		await ev(u1, 'task_submitted', '2026-10-13T23:30:00Z'); // Madrid Wed 01:30
		const utc = await getHeatmap(t.db, { ...r, tz: 'UTC' });
		const mad = await getHeatmap(t.db, { ...r, tz: 'Europe/Madrid' });
		expect(utc[1][10]).toBe(1);
		expect(utc[1][23]).toBe(1);
		expect(mad[1][12]).toBe(1);
		expect(mad[2][1]).toBe(1);
		expect(mad[1][10]).toBe(0);
	});

	it('Sunday is index 6, Monday index 0, and the range bounds apply', async () => {
		await ev(u1, 'task_submitted', '2026-10-18T00:00:00Z'); // Sunday
		await ev(u1, 'task_submitted', '2026-10-19T23:59:00Z'); // Monday
		await ev(u1, 'task_submitted', '2026-09-30T12:00:00Z'); // before from
		await ev(u1, 'task_submitted', '2026-11-01T00:00:00Z'); // == to
		const m = await getHeatmap(t.db, r);
		expect(m[6][0]).toBe(1);
		expect(m[0][23]).toBe(1);
		expect(m.flat().reduce((a, b) => a + b, 0)).toBe(2);
	});

	it('rejects invalid ranges', async () => {
		await expect(getHeatmap(t.db, { from: r.to, to: r.from })).rejects.toBeInstanceOf(
			InvalidRangeError
		);
	});
});

async function mkPeriod() {
	const [p] = await t.db
		.insert(periods)
		.values({ name: 'p', startsAt: D('2026-10-01T00:00:00Z'), status: 'active' })
		.returning();
	return p.id;
}
async function sub(
	userId: number,
	periodId: number,
	taskKey: string,
	status: 'pending' | 'approved' | 'rejected',
	points: number
) {
	await t.db.insert(submissions).values({
		userId,
		taskKey,
		periodId,
		status,
		pointsAwarded: status === 'approved' ? points : 0
	});
}

describe('getTopContributors', () => {
	it('counts only approved credits, orders by points then username', async () => {
		const pid = await mkPeriod();
		const carol = await mkUser('carol');
		await sub(u1, pid, 'dishwasher', 'approved', 5);
		await sub(u1, pid, 'dishwasher', 'approved', 5);
		await sub(u2, pid, 'dishwasher', 'approved', 10); // ties with alice -> alice first
		await sub(carol, pid, 'dishwasher', 'approved', 3);
		await sub(carol, pid, 'dishwasher', 'pending', 50);
		await sub(carol, pid, 'dishwasher', 'rejected', 50);
		const res = await getTopContributors(t.db, pid);
		expect(res).toEqual([
			{ userId: u1, username: 'alice', points: 10, tasks: 2 },
			{ userId: u2, username: 'bob', points: 10, tasks: 1 },
			{ userId: carol, username: 'carol', points: 3, tasks: 1 }
		]);
	});

	it('excludes deactivated users and other periods', async () => {
		const pid = await mkPeriod();
		const gone = await mkUser('gone', false);
		const [other] = await t.db
			.insert(periods)
			.values({
				name: 'old',
				startsAt: D('2026-01-01T00:00:00Z'),
				endsAt: D('2026-02-01T00:00:00Z'),
				status: 'ended'
			})
			.returning();
		await sub(gone, pid, 'dishwasher', 'approved', 99);
		await sub(u1, other.id, 'dishwasher', 'approved', 5);
		await sub(u2, pid, 'dishwasher', 'approved', 1);
		expect((await getTopContributors(t.db, pid)).map((r) => r.username)).toEqual(['bob']);
	});

	it('applies default limit 10 and caps at 50', async () => {
		const pid = await mkPeriod();
		for (let i = 0; i < 55; i++) {
			const id = await mkUser(`u${String(i).padStart(2, '0')}`);
			await sub(id, pid, 'dishwasher', 'approved', 1 + i);
		}
		expect(await getTopContributors(t.db, pid)).toHaveLength(10);
		expect(await getTopContributors(t.db, pid, { limit: 3 })).toHaveLength(3);
		expect(await getTopContributors(t.db, pid, { limit: 500 })).toHaveLength(50);
		expect(await getTopContributors(t.db, pid, { limit: 0 })).toHaveLength(10);
	});
});

describe('getTaskDistribution', () => {
	it('lists all seven tasks with zeros when nothing is approved', async () => {
		const pid = await mkPeriod();
		const res = await getTaskDistribution(t.db, pid);
		expect(res).toHaveLength(7);
		expect(res.every((r) => r.count === 0 && r.points === 0)).toBe(true);
		const labels = res.map((r) => r.label);
		expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
	});

	it('counts only approved submissions, ordered by count desc then label', async () => {
		const pid = await mkPeriod();
		await sub(u1, pid, 'dishwasher', 'approved', 5);
		await sub(u2, pid, 'dishwasher', 'approved', 5);
		await sub(u1, pid, 'dishwasher', 'pending', 5);
		await sub(u1, pid, 'dishwasher', 'rejected', 5);
		const res = await getTaskDistribution(t.db, pid);
		expect(res).toHaveLength(7);
		expect(res[0]).toMatchObject({ taskKey: 'dishwasher', count: 2, points: 10 });
		expect(res.slice(1).every((r) => r.count === 0)).toBe(true);
	});
});
