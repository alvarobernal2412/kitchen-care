import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getTestDb, type TestDb } from '../helpers/testDb';
import {
	comments,
	events,
	periodWinners,
	periods,
	posts,
	reactions,
	submissions,
	users
} from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod, endPeriod } from '../../src/lib/server/periods';
import { getLeaderboard } from '../../src/lib/server/leaderboard';
import { getUserStanding, listRecentActivity } from '../../src/lib/server/standing';
import { getTaskDistribution, getTopContributors } from '../../src/lib/server/analytics';
import { addComment, createPost, onMilestonePost, toggleReaction } from '../../src/lib/server/feed';
import { grantWelcomeBonus } from '../../src/lib/server/welcomeBonus';
import { approve, reject, PeriodClosedError, NotAdminError } from '../../src/lib/server/review';
import { NotRevocableError, SubmissionNotFoundError, revokeSubmission } from '../../src/lib/server/revoke';
import {
	getCooldownState,
	getUserPeriodTotal,
	logTask,
	submitPhotoTask
} from '../../src/lib/server/tasks';

let t: TestDb;
let member: number;
let other: number;
let admin: number;
let dir: string;
const T0 = new Date('2026-10-16T10:00:00Z');
const MIN = 60_000;

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

async function approvedPhoto(userId: number, key: string, now = T0) {
	const s = await submitPhotoTask(t.db, userId, key, await img(), { uploadDir: dir, now });
	await approve(t.db, admin, s.id, { now, onMilestone: onMilestonePost });
	return s.id;
}

const statusOf = async (id: number) =>
	(await t.db.select().from(submissions).where(eq(submissions.id, id)))[0];

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	member = await mkUser('member');
	other = await mkUser('other');
	admin = await mkUser('boss', 'admin');
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-revoke-'));
	await t.db.delete(events);
	await t.db.delete(periodWinners);
	await t.db.delete(posts);
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await t.db.update(users).set({ active: true });
	await createPeriod(t.db, 'Test');
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const period = async () => (await t.db.select().from(periods))[0].id;

describe('revokeSubmission', () => {
	it('removes an auto-approved dishwasher log from every total and frees the cooldown', async () => {
		const s = await logTask(t.db, member, 'dishwasher', { now: T0 });
		await logTask(t.db, other, 'dishwasher', { now: T0 });
		const pid = await period();
		expect(await getUserPeriodTotal(t.db, member, pid)).toBe(2);

		await revokeSubmission(t.db, admin, s.id, '  not actually done ', { now: new Date(T0.getTime() + MIN) });

		const row = await statusOf(s.id);
		expect(row.status).toBe('revoked');
		expect(row.revokedBy).toBe(admin);
		expect(row.revokeReason).toBe('not actually done');
		expect(row.revokedAt).toEqual(new Date(T0.getTime() + MIN));
		expect(row.pointsAwarded).toBe(2); // kept for audit

		expect(await getUserPeriodTotal(t.db, member, pid)).toBe(0);
		expect((await getLeaderboard(t.db, pid)).map((r) => r.userId)).toEqual([other]);
		const standing = await getUserStanding(t.db, member, pid);
		expect(standing).toMatchObject({ points: 0, rank: null, ofTotal: 1 });
		expect((await listRecentActivity(t.db, pid)).map((r) => r.id)).not.toContain(s.id);
		const dist = await getTaskDistribution(t.db, pid);
		expect(dist.find((d) => d.taskKey === 'dishwasher')).toMatchObject({ count: 1, points: 2 });
		expect((await getTopContributors(t.db, pid)).map((r) => r.userId)).toEqual([other]);

		// the cooldown from the removed log is gone: logging again works right away
		expect((await getCooldownState(t.db, member, (await t.db.query.tasks.findFirst({ where: (x, { eq }) => eq(x.key, 'dishwasher') }))!, T0)).remainingSeconds).toBe(0);
		await logTask(t.db, member, 'dishwasher', { now: new Date(T0.getTime() + 2 * MIN) });
		expect(await getUserPeriodTotal(t.db, member, pid)).toBe(2);
	});

	it('removes an approved photo chore but keeps the proof image row', async () => {
		const id = await approvedPhoto(member, 'beans');
		const before = await statusOf(id);
		await revokeSubmission(t.db, admin, id, 'wrong photo');
		const row = await statusOf(id);
		expect(row.status).toBe('revoked');
		expect(row.imagePath).toBe(before.imagePath);
		expect(await readdir(dir)).toHaveLength(1);
		expect(await getUserPeriodTotal(t.db, member, await period())).toBe(0);
	});

	it('lets a revoked review chore with a cooldown (grounds) be submitted again', async () => {
		const id = await approvedPhoto(member, 'grounds');
		await revokeSubmission(t.db, admin, id, 'no grounds in the bin');
		await submitPhotoTask(t.db, member, 'grounds', await img(), {
			uploadDir: dir,
			now: new Date(T0.getTime() + MIN)
		});
	});

	it('deletes the milestone post with its comments and reactions', async () => {
		const id = await approvedPhoto(member, 'descale');
		const [post] = await t.db.select().from(posts).where(eq(posts.milestoneSubmissionId, id));
		expect(post).toBeDefined();
		await addComment(t.db, other, post.id, 'nice');
		await toggleReaction(t.db, other, post.id, '👏');
		await createPost(t.db, other, { body: 'unrelated' });

		await revokeSubmission(t.db, admin, id, 'it was not descaled');

		expect(await t.db.select().from(posts).where(eq(posts.milestoneSubmissionId, id))).toHaveLength(0);
		expect(await t.db.select().from(comments)).toHaveLength(0);
		expect(await t.db.select().from(reactions)).toHaveLength(0);
		expect(await t.db.select().from(posts)).toHaveLength(1);
		expect(await getUserPeriodTotal(t.db, member, await period())).toBe(0);
	});

	it('removes the welcome bonus for good', async () => {
		await t.db.transaction(async (tx) => {
			expect(await grantWelcomeBonus(tx, member, T0)).toBe(true);
		});
		const pid = await period();
		expect(await getUserPeriodTotal(t.db, member, pid)).toBe(10);
		const [bonus] = await t.db.select().from(submissions);
		await revokeSubmission(t.db, admin, bonus.id, 'duplicate account');
		expect(await getUserPeriodTotal(t.db, member, pid)).toBe(0);
		await t.db.transaction(async (tx) => {
			expect(await grantWelcomeBonus(tx, member, T0)).toBe(false);
		});
		expect(await getUserPeriodTotal(t.db, member, pid)).toBe(0);
	});

	it('is admin only, checked on the live row', async () => {
		const s = await logTask(t.db, member, 'dishwasher', { now: T0 });
		await expect(revokeSubmission(t.db, member, s.id, 'x')).rejects.toBeInstanceOf(NotAdminError);
		await expect(revokeSubmission(t.db, 99999, s.id, 'x')).rejects.toBeInstanceOf(NotAdminError);
		const gone = await mkUser('gone-admin', 'admin', false);
		await expect(revokeSubmission(t.db, gone, s.id, 'x')).rejects.toBeInstanceOf(NotAdminError);
		expect((await statusOf(s.id)).status).toBe('approved');
	});

	it('refuses anything that is not approved, and unknown ids', async () => {
		const s = await logTask(t.db, member, 'dishwasher', { now: T0 });
		await revokeSubmission(t.db, admin, s.id, 'first');
		await expect(revokeSubmission(t.db, admin, s.id, 'again')).rejects.toBeInstanceOf(NotRevocableError);
		expect((await statusOf(s.id)).revokeReason).toBe('first');

		const pending = await submitPhotoTask(t.db, member, 'milk', await img(), { uploadDir: dir, now: T0 });
		await expect(revokeSubmission(t.db, admin, pending.id, 'x')).rejects.toBeInstanceOf(NotRevocableError);
		const toReject = await submitPhotoTask(t.db, member, 'milk', await img(), { uploadDir: dir, now: T0 });
		await reject(t.db, admin, toReject.id, 'blurry', { uploadDir: dir });
		await expect(revokeSubmission(t.db, admin, toReject.id, 'x')).rejects.toBeInstanceOf(NotRevocableError);

		await expect(revokeSubmission(t.db, admin, 424242, 'x')).rejects.toBeInstanceOf(SubmissionNotFoundError);
	});

	it('refuses once the period has ended and changes nothing', async () => {
		const s = await logTask(t.db, member, 'dishwasher', { now: T0 });
		const pid = await period();
		await endPeriod(t.db, pid);
		await expect(revokeSubmission(t.db, admin, s.id, 'late')).rejects.toBeInstanceOf(PeriodClosedError);
		const row = await statusOf(s.id);
		expect(row.status).toBe('approved');
		expect(row.revokedAt).toBeNull();
		expect(await t.db.select().from(periodWinners)).toHaveLength(1);
	});

	it('validates the reason', async () => {
		const s = await logTask(t.db, member, 'dishwasher', { now: T0 });
		for (const bad of ['', '   ', '\u0000\u0007​', 'a'.repeat(201)]) {
			await expect(revokeSubmission(t.db, admin, s.id, bad)).rejects.toBeInstanceOf(ZodError);
		}
		expect((await statusOf(s.id)).status).toBe('approved');
		await revokeSubmission(t.db, admin, s.id, `a\u0000b${'c'.repeat(197)}\u0007`);
		const row = await statusOf(s.id);
		expect(row.revokeReason).toBe(`ab${'c'.repeat(197)}`);
	});

	it('concurrent double revoke: exactly one succeeds', async () => {
		const s = await logTask(t.db, member, 'dishwasher', { now: T0 });
		const results = await Promise.allSettled([
			revokeSubmission(t.db, admin, s.id, 'one'),
			revokeSubmission(t.db, admin, s.id, 'two')
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(failed.reason).toBeInstanceOf(NotRevocableError);
	});

	it('serialises with endPeriod: the frozen winners always match the revoked state', async () => {
		for (let i = 0; i < 5; i++) {
			await t.db.delete(periodWinners);
			await t.db.delete(submissions);
			await t.db.delete(periods);
			const pid = (await createPeriod(t.db, `P${i}`)).id;
			const a = await logTask(t.db, member, 'dishwasher', { now: T0 });
			await logTask(t.db, other, 'cutlery', { now: T0 });
			const [rev, end] = await Promise.allSettled([
				revokeSubmission(t.db, admin, a.id, 'race'),
				endPeriod(t.db, pid)
			]);
			expect(end.status).toBe('fulfilled');
			const winners = await t.db.select().from(periodWinners);
			const row = await statusOf(a.id);
			if (rev.status === 'fulfilled') {
				// revoke committed before the end: winners reflect it
				expect(row.status).toBe('revoked');
				expect(winners.map((w) => w.userId)).toEqual([other]);
			} else {
				expect(rev.reason).toBeInstanceOf(PeriodClosedError);
				expect(row.status).toBe('approved');
				expect(winners.map((w) => w.userId)).toEqual([member]);
			}
		}
	});
});
