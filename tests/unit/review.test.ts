import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod, endPeriod } from '../../src/lib/server/periods';
import { getLeaderboard } from '../../src/lib/server/leaderboard';
import { InvalidImageError } from '../../src/lib/server/images';
import {
	CooldownError,
	DetectionFailedError,
	NoActivePeriodError,
	NotAReviewTaskError,
	TooManyPendingError,
	UnknownTaskError,
	getUserPeriodTotal,
	submitCutleryTask,
	submitPhotoTask
} from '../../src/lib/server/tasks';
import {
	AlreadyReviewedError,
	NotAdminError,
	PeriodClosedError,
	approve,
	reject
} from '../../src/lib/server/review';

let t: TestDb;
let user: number;
let admin: number;
let dir: string;
const T0 = new Date('2026-10-16T10:00:00Z');

async function mkUser(name: string, role: 'user' | 'admin' = 'user', active = true) {
	const [row] = await t.db
		.insert(users)
		.values({ usernameNormalized: name, displayUsername: name, passwordHash: 'x', role, active })
		.returning();
	return row.id;
}

async function img(): Promise<Buffer> {
	return sharp({ create: { width: 64, height: 64, channels: 3, background: '#a33' } })
		.jpeg()
		.toBuffer();
}

const files = () => readdir(dir);

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	user = await mkUser('member');
	admin = await mkUser('boss', 'admin');
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-review-'));
	await t.db.delete(events);
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await t.db.update(users).set({ active: true });
	await createPeriod(t.db, 'Test');
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('submitPhotoTask', () => {
	it('creates a pending submission with 0 points and a stored file', async () => {
		const s = await submitPhotoTask(t.db, user, 'beans', await img(), { uploadDir: dir, now: T0 });
		expect(s.status).toBe('pending');
		expect(s.pointsAwarded).toBe(0);
		expect(s.periodId).not.toBeNull();
		expect(await files()).toEqual([s.imagePath]);
		expect(await getUserPeriodTotal(t.db, user, s.periodId!)).toBe(0);
	});

	it('rejects invalid image bytes with no row and no file', async () => {
		await expect(
			submitPhotoTask(t.db, user, 'beans', Buffer.from('not an image'), { uploadDir: dir })
		).rejects.toBeInstanceOf(InvalidImageError);
		expect(await t.db.select().from(submissions)).toHaveLength(0);
		expect(await files()).toHaveLength(0);
	});

	it('rejects unknown and non-review tasks', async () => {
		await expect(
			submitPhotoTask(t.db, user, 'nope', await img(), { uploadDir: dir })
		).rejects.toBeInstanceOf(UnknownTaskError);
		await expect(
			submitPhotoTask(t.db, user, 'dishwasher', await img(), { uploadDir: dir })
		).rejects.toBeInstanceOf(NotAReviewTaskError);
		expect(await files()).toHaveLength(0);
	});

	it('requires an active period and writes no file without one', async () => {
		await t.db.delete(periods);
		await expect(
			submitPhotoTask(t.db, user, 'beans', await img(), { uploadDir: dir })
		).rejects.toBeInstanceOf(NoActivePeriodError);
		expect(await files()).toHaveLength(0);
	});

	it('allows at most 3 pending per user per task', async () => {
		for (let i = 0; i < 3; i++) {
			await submitPhotoTask(t.db, user, 'beans', await img(), { uploadDir: dir });
		}
		await expect(
			submitPhotoTask(t.db, user, 'beans', await img(), { uploadDir: dir })
		).rejects.toBeInstanceOf(TooManyPendingError);
		expect(await files()).toHaveLength(3);
		// another task is unaffected
		await submitPhotoTask(t.db, user, 'milk', await img(), { uploadDir: dir });
	});
});

describe('submitCutleryTask', () => {
	it('throws unless the client check passed', async () => {
		await expect(submitCutleryTask(t.db, user, false, { now: T0 })).rejects.toBeInstanceOf(
			DetectionFailedError
		);
		expect(await t.db.select().from(submissions)).toHaveLength(0);
	});

	it('credits 1 point, stores no image and writes no file', async () => {
		const s = await submitCutleryTask(t.db, user, true, { now: T0, uploadDir: dir });
		expect(s.status).toBe('approved');
		expect(s.pointsAwarded).toBe(1);
		expect(s.imagePath).toBeNull();
		expect(await files()).toHaveLength(0);
	});

	it('enforces the 30 minute cooldown', async () => {
		await submitCutleryTask(t.db, user, true, { now: T0 });
		await expect(
			submitCutleryTask(t.db, user, true, { now: new Date(T0.getTime() + 10 * 60_000) })
		).rejects.toBeInstanceOf(CooldownError);
	});
});

describe('approve / reject', () => {
	async function pending(task = 'beans') {
		return submitPhotoTask(t.db, user, task, await img(), { uploadDir: dir, now: T0 });
	}

	it('approve credits the task points', async () => {
		const s = await pending();
		await approve(t.db, admin, s.id, { now: T0 });
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, s.id));
		expect(row.status).toBe('approved');
		expect(row.pointsAwarded).toBe(5);
		expect(row.reviewedBy).toBe(admin);
		expect(row.reviewedAt).not.toBeNull();
		expect(await getUserPeriodTotal(t.db, user, s.periodId!)).toBe(5);
	});

	it('approving twice credits once', async () => {
		const s = await pending();
		await approve(t.db, admin, s.id);
		await expect(approve(t.db, admin, s.id)).rejects.toBeInstanceOf(AlreadyReviewedError);
		expect(await getUserPeriodTotal(t.db, user, s.periodId!)).toBe(5);
	});

	it('concurrent double approve credits once', async () => {
		const s = await pending();
		const results = await Promise.allSettled([
			approve(t.db, admin, s.id),
			approve(t.db, admin, s.id)
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(failed.reason).toBeInstanceOf(AlreadyReviewedError);
		expect(await getUserPeriodTotal(t.db, user, s.periodId!)).toBe(5);
	});

	it('reject stores the reason, credits nothing and removes the file', async () => {
		const s = await pending();
		await reject(t.db, admin, s.id, 'Photo unclear', { uploadDir: dir });
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, s.id));
		expect(row.status).toBe('rejected');
		expect(row.rejectReason).toBe('Photo unclear');
		expect(row.pointsAwarded).toBe(0);
		expect(row.reviewedBy).toBe(admin);
		expect(await getUserPeriodTotal(t.db, user, s.periodId!)).toBe(0);
		expect(await files()).toHaveLength(0);
		await expect(approve(t.db, admin, s.id)).rejects.toBeInstanceOf(AlreadyReviewedError);
	});

	it('reject validates the reason length', async () => {
		const s = await pending();
		await expect(reject(t.db, admin, s.id, '')).rejects.toThrow();
		await expect(reject(t.db, admin, s.id, 'x'.repeat(201))).rejects.toThrow();
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, s.id));
		expect(row.status).toBe('pending');
	});

	it('calls onMilestone once for descale, never for beans', async () => {
		const onMilestone = vi.fn<(s: unknown, tx: unknown) => Promise<void>>(async () => {});
		const b = await pending('beans');
		await approve(t.db, admin, b.id, { onMilestone });
		expect(onMilestone).not.toHaveBeenCalled();
		const d = await pending('descale');
		await approve(t.db, admin, d.id, { onMilestone });
		expect(onMilestone).toHaveBeenCalledTimes(1);
		expect(onMilestone.mock.calls[0][0]).toMatchObject({ id: d.id, status: 'approved' });
	});

	it('rolls back when onMilestone fails', async () => {
		const d = await pending('descale');
		await expect(
			approve(t.db, admin, d.id, {
				onMilestone: async () => {
					throw new Error('boom');
				}
			})
		).rejects.toThrow('boom');
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, d.id));
		expect(row.status).toBe('pending');
		expect(row.pointsAwarded).toBe(0);
		expect(row.reviewedBy).toBeNull();
	});

	it('refuses to approve after the period ended', async () => {
		const s = await pending();
		await endPeriod(t.db, s.periodId!);
		await expect(approve(t.db, admin, s.id)).rejects.toBeInstanceOf(PeriodClosedError);
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, s.id));
		expect(row.status).toBe('pending');
		expect(row.pointsAwarded).toBe(0);
	});

	it('only active admins can review', async () => {
		const s = await pending();
		await expect(approve(t.db, user, s.id)).rejects.toBeInstanceOf(NotAdminError);
		await expect(reject(t.db, user, s.id, 'x')).rejects.toBeInstanceOf(NotAdminError);
		const inactiveAdmin = await mkUser('gone', 'admin', false);
		await expect(approve(t.db, inactiveAdmin, s.id)).rejects.toBeInstanceOf(NotAdminError);
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, s.id));
		expect(row.status).toBe('pending');
	});

	it('approves a submission from a since-deactivated user, hidden from the leaderboard', async () => {
		const s = await pending();
		await t.db.update(users).set({ active: false }).where(eq(users.id, user));
		await approve(t.db, admin, s.id);
		expect(await getUserPeriodTotal(t.db, user, s.periodId!)).toBe(5);
		expect(await getLeaderboard(t.db, s.periodId!)).toHaveLength(0);
	});
});
