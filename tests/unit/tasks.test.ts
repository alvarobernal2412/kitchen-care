import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import {
	CooldownError,
	InactiveUserError,
	NoActivePeriodError,
	TaskRequiresReviewError,
	UnknownTaskError,
	logTask
} from '../../src/lib/server/tasks';

let t: TestDb;
let u1: number;
let u2: number;
const T0 = new Date('2026-10-16T10:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const after = (ms: number) => new Date(T0.getTime() + ms);

async function mkUser(name: string, active = true) {
	const [row] = await t.db
		.insert(users)
		.values({ usernameNormalized: name, displayUsername: name, passwordHash: 'x', active })
		.returning();
	return row.id;
}

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	u1 = await mkUser('one');
	u2 = await mkUser('two');
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	await t.db.delete(events);
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await createPeriod(t.db, 'Test');
});

async function cooldownOf(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err).toBeInstanceOf(CooldownError);
	return (err as CooldownError).retryAfterSeconds;
}

describe('logTask', () => {
	it('credits dishwasher points immediately', async () => {
		const s = await logTask(t.db, u1, 'dishwasher', { now: T0 });
		expect(s.status).toBe('approved');
		expect(s.pointsAwarded).toBe(2);
		expect(s.createdAt.getTime()).toBe(T0.getTime());
		const ev = await t.db.select().from(events).where(eq(events.type, 'task_submitted'));
		expect(ev).toHaveLength(1);
		expect(ev[0].userId).toBe(u1);
	});

	it('enforces the cooldown with a ceil-ed retryAfterSeconds', async () => {
		await logTask(t.db, u1, 'dishwasher', { now: T0 });
		expect(
			await cooldownOf(logTask(t.db, u1, 'dishwasher', { now: after(2 * HOUR + 29 * MIN) }))
		).toBe(60);
		expect(
			await cooldownOf(logTask(t.db, u1, 'dishwasher', { now: after(2 * HOUR + 29 * MIN + 500) }))
		).toBe(60);
	});

	it('succeeds exactly at the cooldown boundary', async () => {
		await logTask(t.db, u1, 'dishwasher', { now: T0 });
		const s = await logTask(t.db, u1, 'dishwasher', { now: after(2 * HOUR + 30 * MIN) });
		expect(s.pointsAwarded).toBe(2);
	});

	it('blocks dishwasher twice within 2 h', async () => {
		await logTask(t.db, u1, 'dishwasher', { now: T0 });
		await cooldownOf(logTask(t.db, u1, 'dishwasher', { now: after(2 * HOUR) }));
	});

	it('throws NoActivePeriodError without an active period', async () => {
		await t.db.delete(periods);
		await expect(logTask(t.db, u1, 'dishwasher')).rejects.toBeInstanceOf(NoActivePeriodError);
	});

	it('lets only one of two simultaneous logs through', async () => {
		const results = await Promise.allSettled([
			logTask(t.db, u1, 'dishwasher', { now: T0 }),
			logTask(t.db, u1, 'dishwasher', { now: T0 })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CooldownError);
	});

	it('does not block other users or other tasks', async () => {
		await logTask(t.db, u1, 'dishwasher', { now: T0 });
		await logTask(t.db, u2, 'dishwasher', { now: T0 });
		await logTask(t.db, u1, 'cutlery', { now: T0 });
		expect(await t.db.select().from(submissions)).toHaveLength(3);
	});

	it('rejects review tasks and unknown keys', async () => {
		await expect(logTask(t.db, u1, 'grounds')).rejects.toBeInstanceOf(TaskRequiresReviewError);
		await expect(logTask(t.db, u1, 'beans')).rejects.toBeInstanceOf(TaskRequiresReviewError);
		await expect(logTask(t.db, u1, 'nope')).rejects.toBeInstanceOf(UnknownTaskError);
	});

	it('auto-approves cutlery with no image for 1 point', async () => {
		const s = await logTask(t.db, u1, 'cutlery', { now: T0 });
		expect(s.pointsAwarded).toBe(1);
		expect(s.imagePath).toBeNull();
		expect(s.status).toBe('approved');
	});

	it('never credits into a period that is being ended concurrently', async () => {
		const [active] = await t.db.select().from(periods);
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let started!: () => void;
		const updated = new Promise<void>((r) => (started = r));
		const ending = t.db.transaction(async (tx) => {
			await tx.update(periods).set({ status: 'ended', endsAt: new Date() }).where(eq(periods.id, active.id));
			started();
			await gate;
		});
		await updated;
		const logging = logTask(t.db, u1, 'dishwasher', { now: T0 }).then(
			() => null,
			(e) => e
		);
		// The log must be blocked on the period row while the end is uncommitted.
		const early = await Promise.race([logging, new Promise((r) => setTimeout(() => r('pending'), 300))]);
		expect(early).toBe('pending');
		release();
		await ending;
		expect(await logging).toBeInstanceOf(NoActivePeriodError);
		expect(await t.db.select().from(submissions)).toHaveLength(0);
	});

	it('rejects inactive users', async () => {
		const u3 = await mkUser('gone', false);
		await expect(logTask(t.db, u3, 'dishwasher')).rejects.toBeInstanceOf(InactiveUserError);
	});
});
