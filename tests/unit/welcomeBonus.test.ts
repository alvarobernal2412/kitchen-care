import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, periodWinners, periods, submissions, tasks, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { AuthError, signUp } from '../../src/lib/server/auth/users';
import { createPeriod, endPeriod } from '../../src/lib/server/periods';
import { getLeaderboard } from '../../src/lib/server/leaderboard';
import { getUserStanding, listRecentActivity } from '../../src/lib/server/standing';
import { getTaskDistribution, getTopContributors } from '../../src/lib/server/analytics';
import { logTask } from '../../src/lib/server/tasks';
import { resetRateLimits } from '../../src/lib/server/ratelimit';
import {
	DEFAULT_WELCOME_BONUS_UNTIL,
	WELCOME_BONUS_POINTS,
	grantWelcomeBonus,
	isWelcomeBonusOpen,
	welcomeBonusDeadline,
	welcomeBonusOffer
} from '../../src/lib/server/welcomeBonus';

let t: TestDb;
vi.mock('$lib/server/db', () => ({ getDb: () => t.db }));

const PW = 'Abcdef1!';
const BEFORE = new Date('2026-10-17T12:00:00Z');
const CUTOFF = new Date('2026-11-20T00:00:00+01:00');
let seq = 0;

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	resetRateLimits();
	await t.db.delete(periodWinners);
	await t.db.delete(submissions);
	await t.db.delete(events);
	await t.db.delete(periods);
	await t.db.delete(users);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete process.env.WELCOME_BONUS_UNTIL;
	delete process.env.APP_TIMEZONE;
});

const join = (name = `bonus${++seq}`, now: Date = BEFORE) =>
	signUp(t.db, { username: name, password: PW, classification: 'Student' }, { now });
const bonusRows = (userId?: number) =>
	t.db
		.select()
		.from(submissions)
		.where(eq(submissions.taskKey, 'welcome_bonus'))
		.then((rows) => (userId === undefined ? rows : rows.filter((r) => r.userId === userId)));

describe('welcomeBonusDeadline', () => {
	it('defaults to 20 November 2026 00:00 Zurich', () => {
		expect(DEFAULT_WELCOME_BONUS_UNTIL.toISOString()).toBe('2026-11-19T23:00:00.000Z');
		expect(welcomeBonusDeadline(undefined).getTime()).toBe(CUTOFF.getTime());
	});

	it('reads an ISO timestamp with an offset or Z', () => {
		expect(welcomeBonusDeadline('2026-12-01T10:00:00+02:00').toISOString()).toBe('2026-12-01T08:00:00.000Z');
		expect(welcomeBonusDeadline('2026-12-01T08:00:00Z').toISOString()).toBe('2026-12-01T08:00:00.000Z');
		expect(welcomeBonusDeadline('2026-12-01T08:00Z').toISOString()).toBe('2026-12-01T08:00:00.000Z');
	});

	it('uses the default for an empty value, silently', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(welcomeBonusDeadline('').getTime()).toBe(CUTOFF.getTime());
		expect(welcomeBonusDeadline('   ').getTime()).toBe(CUTOFF.getTime());
		expect(warn).not.toHaveBeenCalled();
	});

	it('uses the default and warns once for an invalid value', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		for (const bad of ['next week', '2026-11-20', '2026-11-20T00:00:00', '2026-13-40T00:00:00Z']) {
			expect(welcomeBonusDeadline(bad).getTime()).toBe(CUTOFF.getTime());
		}
		expect(warn).toHaveBeenCalledTimes(4);
		warn.mockClear();
		welcomeBonusDeadline('next week');
		expect(warn).not.toHaveBeenCalled();
	});

	it('accepts a value in the past (the bonus is then simply over)', () => {
		const d = welcomeBonusDeadline('2000-01-01T00:00:00Z');
		expect(isWelcomeBonusOpen(BEFORE, d)).toBe(false);
	});

	it('reads WELCOME_BONUS_UNTIL by default', () => {
		process.env.WELCOME_BONUS_UNTIL = '2027-01-01T00:00:00Z';
		expect(welcomeBonusDeadline().toISOString()).toBe('2027-01-01T00:00:00.000Z');
	});
});

describe('isWelcomeBonusOpen', () => {
	it('is open strictly before the cutoff', () => {
		expect(isWelcomeBonusOpen(new Date(CUTOFF.getTime() - 1), CUTOFF)).toBe(true);
		expect(isWelcomeBonusOpen(CUTOFF, CUTOFF)).toBe(false);
		expect(isWelcomeBonusOpen(new Date(CUTOFF.getTime() + 1), CUTOFF)).toBe(false);
	});
});

describe('signUp welcome bonus', () => {
	it('credits an approved 10-point submission into the active period', async () => {
		const p = await createPeriod(t.db, 'P');
		const u = await join();
		const [row, ...rest] = await bonusRows(u.id);
		expect(rest).toHaveLength(0);
		expect(row).toMatchObject({
			status: 'approved',
			pointsAwarded: WELCOME_BONUS_POINTS,
			periodId: p.id,
			imagePath: null
		});
		expect(row.createdAt).toEqual(BEFORE);
		expect(row.reviewedAt).toEqual(BEFORE);
		const board = await getLeaderboard(t.db, p.id);
		expect(board).toMatchObject([{ userId: u.id, points: 10, rank: 1 }]);
		expect(await getUserStanding(t.db, u.id, p.id)).toMatchObject({ points: 10, rank: 1 });
	});

	it('grants nothing at or after the cutoff', async () => {
		await createPeriod(t.db, 'P');
		const a = await join('atcut', CUTOFF);
		const b = await join('aftercut', new Date(CUTOFF.getTime() + 86_400_000));
		expect(await bonusRows(a.id)).toHaveLength(0);
		expect(await bonusRows(b.id)).toHaveLength(0);
	});

	it('grants nothing, without error, when no period is active', async () => {
		const u = await join();
		expect(u.id).toBeGreaterThan(0);
		expect(await bonusRows()).toHaveLength(0);
	});

	it('never lands in an ended period', async () => {
		const p = await createPeriod(t.db, 'P');
		await endPeriod(t.db, p.id);
		const u = await join();
		expect(await bonusRows(u.id)).toHaveLength(0);
	});

	it('is counted by endPeriod: the winner list includes the bonus', async () => {
		const p = await createPeriod(t.db, 'P');
		const u = await join();
		const winners = await endPeriod(t.db, p.id);
		expect(winners).toMatchObject([{ userId: u.id, points: 10, rank: 1 }]);
		expect(await getLeaderboard(t.db, p.id)).toMatchObject([{ userId: u.id, points: 10 }]);
	});

	it('creates no bonus when the username is taken, and the first user keeps exactly one', async () => {
		await createPeriod(t.db, 'P');
		const first = await join('dupe');
		const err = await join('DUPE').then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(AuthError);
		expect((err as AuthError).code).toBe('username_taken');
		expect(await bonusRows()).toHaveLength(1);
		expect(await bonusRows(first.id)).toHaveLength(1);
	});

	it('gives two concurrent signups one bonus each', async () => {
		await createPeriod(t.db, 'P');
		const [a, b] = await Promise.all([join('racea'), join('raceb')]);
		expect(await bonusRows(a.id)).toHaveLength(1);
		expect(await bonusRows(b.id)).toHaveLength(1);
	});

	it('rolls the user back when the bonus cannot be written', async () => {
		await createPeriod(t.db, 'P');
		await t.db.delete(tasks).where(eq(tasks.key, 'welcome_bonus')); // the FK now rejects the bonus row
		try {
			await expect(join('rolledback')).rejects.toThrow();
			expect(await t.db.select().from(users).where(eq(users.usernameNormalized, 'rolledback'))).toHaveLength(0);
		} finally {
			await seedTasks(t.db);
		}
	});

	it('is enforced once per user by the partial unique index', async () => {
		await createPeriod(t.db, 'P');
		const u = await join();
		const [first] = await bonusRows(u.id);
		await expect(
			t.db.insert(submissions).values({
				userId: u.id,
				taskKey: 'welcome_bonus',
				periodId: first.periodId,
				status: 'approved',
				pointsAwarded: 10
			})
		).rejects.toThrow();
		expect(await t.db.transaction((tx) => grantWelcomeBonus(tx, u.id, BEFORE))).toBe(false);
		expect(await bonusRows(u.id)).toHaveLength(1);
	});

	it('does not affect other tasks of the same user (index is partial)', async () => {
		await createPeriod(t.db, 'P');
		const u = await join();
		await logTask(t.db, u.id, 'dishwasher', { now: BEFORE });
		await logTask(t.db, u.id, 'cutlery', { now: BEFORE });
		expect(await getLeaderboard(t.db, (await bonusRows(u.id))[0].periodId!)).toMatchObject([
			{ userId: u.id, points: 13 }
		]);
	});
});

describe('welcome bonus visibility', () => {
	it('is left out of the public recent activity', async () => {
		const p = await createPeriod(t.db, 'P');
		const u = await join();
		expect(await listRecentActivity(t.db, p.id)).toEqual([]);
		await logTask(t.db, u.id, 'dishwasher', { now: BEFORE });
		expect((await listRecentActivity(t.db, p.id)).map((a) => a.taskKey)).toEqual(['dishwasher']);
	});

	it('is not a chore in the task distribution', async () => {
		const p = await createPeriod(t.db, 'P');
		await join();
		const dist = await getTaskDistribution(t.db, p.id);
		expect(dist).toHaveLength(7);
		expect(dist.map((d) => d.taskKey)).not.toContain('welcome_bonus');
		expect(dist.every((d) => d.count === 0 && d.points === 0)).toBe(true);
	});

	it('counts points but not tasks in top contributors', async () => {
		const p = await createPeriod(t.db, 'P');
		const only = await join('onlybonus');
		const top = await getTopContributors(t.db, p.id);
		expect(top).toEqual([{ userId: only.id, username: 'onlybonus', points: 10, tasks: 0 }]);
		await logTask(t.db, only.id, 'dishwasher', { now: BEFORE });
		expect((await getTopContributors(t.db, p.id))[0]).toMatchObject({ points: 12, tasks: 1 });
	});

	it('writes no task_submitted event', async () => {
		await createPeriod(t.db, 'P');
		await join();
		expect(await t.db.select().from(events).where(eq(events.type, 'task_submitted'))).toHaveLength(0);
	});
});

describe('task APIs refuse the welcome bonus', () => {
	let userId: number;
	beforeEach(async () => {
		await createPeriod(t.db, 'P');
		userId = (await join()).id;
	});

	it('POST /api/tasks/welcome_bonus is a 404 and credits nothing', async () => {
		const { POST } = await import('../../src/routes/api/tasks/[key]/+server');
		const res = await POST({
			locals: { user: { id: userId } },
			params: { key: 'welcome_bonus' }
		} as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'unknown_task' });
		expect(await bonusRows(userId)).toHaveLength(1);
	});

	it('POST /api/submissions with welcome_bonus is refused (photo and json)', async () => {
		const { POST } = await import('../../src/routes/api/submissions/+server');
		const call = (request: Request) =>
			POST({ locals: { user: { id: userId, active: true } }, request } as unknown as Parameters<typeof POST>[0]);

		const form = new FormData();
		form.set('taskKey', 'welcome_bonus');
		form.set('image', new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }));
		// Like a browser: serialise first so Content-Length is present.
		const probe = new Response(form);
		const bytes = new Uint8Array(await probe.arrayBuffer());
		const photo = await call(
			new Request('http://x/api/submissions', {
				method: 'POST',
				headers: {
					'content-type': probe.headers.get('content-type')!,
					'content-length': String(bytes.length)
				},
				body: bytes
			})
		);
		expect(photo.status).toBe(404);

		const json = await call(
			new Request('http://x/api/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ taskKey: 'welcome_bonus', detected: true })
			})
		);
		expect(json.status).toBe(400);
		expect(await bonusRows(userId)).toHaveLength(1);
	});
});

describe('signup page offer', () => {
	it('is open before the cutoff with an active period', async () => {
		process.env.APP_TIMEZONE = 'Europe/Zurich';
		await createPeriod(t.db, 'P');
		expect(await welcomeBonusOffer(t.db, BEFORE)).toEqual({ open: true, untilLabel: '20 November' });
	});

	it('is closed without an active period', async () => {
		expect(await welcomeBonusOffer(t.db, BEFORE)).toEqual({ open: false, untilLabel: null });
	});

	it('is closed at the cutoff', async () => {
		await createPeriod(t.db, 'P');
		expect(await welcomeBonusOffer(t.db, CUTOFF)).toEqual({ open: false, untilLabel: null });
	});

	it('page load: exposes only the flag, label and amount', async () => {
		process.env.APP_TIMEZONE = 'Europe/Zurich';
		const { load } = await import('../../src/routes/(auth)/signup/+page.server');
		const run = () => (load as unknown as (e: unknown) => Promise<Record<string, unknown>>)({ locals: { user: null } });

		vi.setSystemTime(BEFORE);
		expect((await run()).welcomeBonus).toEqual({ open: false, untilLabel: null, points: 10 }); // no period yet

		await createPeriod(t.db, 'P');
		expect((await run()).welcomeBonus).toEqual({ open: true, untilLabel: '20 November', points: 10 });

		process.env.WELCOME_BONUS_UNTIL = '2026-12-24T12:00:00+01:00';
		expect(((await run()).welcomeBonus as { untilLabel: string }).untilLabel).toBe('24 December');

		vi.setSystemTime(new Date('2026-11-20T00:00:00+01:00'));
		delete process.env.WELCOME_BONUS_UNTIL;
		expect((await run()).welcomeBonus).toEqual({ open: false, untilLabel: null, points: 10 });
	});
});
