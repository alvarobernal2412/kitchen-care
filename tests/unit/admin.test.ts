import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import {
	periodWinners,
	periods,
	posts,
	resetTokens,
	sessions,
	submissions,
	users
} from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { login } from '../../src/lib/server/auth/session';
import { createResetToken } from '../../src/lib/server/auth/reset';
import { signUp } from '../../src/lib/server/auth/users';
import { getLeaderboard } from '../../src/lib/server/leaderboard';
import { countPendingInPeriod, createPeriod, endPeriod } from '../../src/lib/server/periods';
import { NotAdminError } from '../../src/lib/server/review';
import { createMilestonePost } from '../../src/lib/server/feed';
import {
	LastAdminError,
	PeriodNotEndedError,
	SelfChangeError,
	UserNotFoundError,
	deletePeriodImages,
	searchUsers,
	setActive,
	setRole
} from '../../src/lib/server/admin';

const PW = 'Abcdef1!';
let t: TestDb;
let dir: string;
let seq = 0;

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	dir = await mkdtemp(join(tmpdir(), 'kc-admin-'));
});
afterAll(async () => {
	await t.close();
	await rm(dir, { recursive: true, force: true });
});

async function mk(name = `user${++seq}`, role: 'user' | 'admin' = 'user') {
	const u = await signUp(t.db, { username: name, password: PW, classification: 'Student' });
	if (role === 'admin') await t.db.update(users).set({ role }).where(eq(users.id, u.id));
	return u.id;
}
const roleOf = async (id: number) =>
	(await t.db.select().from(users).where(eq(users.id, id)))[0].role;
const activeOf = async (id: number) =>
	(await t.db.select().from(users).where(eq(users.id, id)))[0].active;
const subOf = async (id: number) =>
	(await t.db.select().from(submissions).where(eq(submissions.id, id)))[0];

describe('searchUsers', () => {
	it('matches case-insensitively and lists everything for an empty query', async () => {
		const id = await mk('SearchMeCamel');
		expect((await searchUsers(t.db, 'searchmecamel')).map((r) => r.id)).toEqual([id]);
		expect((await searchUsers(t.db, 'SEARCHME')).map((r) => r.id)).toEqual([id]);
		expect((await searchUsers(t.db, '')).length).toBeGreaterThanOrEqual(1);
		const row = (await searchUsers(t.db, 'searchmecamel'))[0];
		expect(row).toMatchObject({
			username: 'SearchMeCamel',
			role: 'user',
			classification: 'Student',
			active: true,
			points: 0
		});
		expect(row.createdAt).toBeInstanceOf(Date);
	});

	it('treats % and _ literally', async () => {
		await mk('plainname');
		const raw = async (name: string) =>
			(
				await t.db
					.insert(users)
					.values({ usernameNormalized: name, displayUsername: name, passwordHash: 'x' })
					.returning()
			)[0].id;
		const pct = await raw('he100%done');
		const under = await raw('a_b_user');
		await mk('axbxuser');
		expect((await searchUsers(t.db, '100%')).map((r) => r.id)).toEqual([pct]);
		expect((await searchUsers(t.db, '%')).map((r) => r.id)).toEqual([pct]);
		expect((await searchUsers(t.db, 'a_b')).map((r) => r.id)).toEqual([under]);
	});

	it('caps the limit at 200 and defaults to 50', async () => {
		await t.db.insert(users).values(
			Array.from({ length: 210 }, (_, i) => ({
				usernameNormalized: `bulk${i}`,
				displayUsername: `bulk${i}`,
				passwordHash: 'x'
			}))
		);
		expect(await searchUsers(t.db, 'bulk')).toHaveLength(50);
		expect(await searchUsers(t.db, 'bulk', { limit: 5 })).toHaveLength(5);
		expect(await searchUsers(t.db, 'bulk', { limit: 9999 })).toHaveLength(200);
		expect(await searchUsers(t.db, 'bulk', { limit: 0 })).toHaveLength(1);
	});

	it('reports approved points in the active period only', async () => {
		const u = await mk('pointy');
		const [p] = await t.db
			.insert(periods)
			.values({ name: 'old', startsAt: new Date(), endsAt: new Date(), status: 'ended' })
			.returning();
		await t.db.insert(submissions).values({
			userId: u,
			taskKey: 'dishwasher',
			periodId: p.id,
			status: 'approved',
			pointsAwarded: 7
		});
		expect((await searchUsers(t.db, 'pointy'))[0].points).toBe(0);
		const active = await createPeriod(t.db, 'now');
		await t.db.insert(submissions).values([
			{ userId: u, taskKey: 'dishwasher', periodId: active.id, status: 'approved', pointsAwarded: 5 },
			{ userId: u, taskKey: 'dishwasher', periodId: active.id, status: 'pending', pointsAwarded: 0 }
		]);
		expect((await searchUsers(t.db, 'pointy'))[0].points).toBe(5);
		expect(await countPendingInPeriod(t.db, active.id)).toBe(1);
		expect(await countPendingInPeriod(t.db, p.id)).toBe(0);
		await endPeriod(t.db, active.id);
	});
});

describe('setRole / setActive', () => {
	it('promotes and demotes another admin', async () => {
		const a = await mk(undefined, 'admin');
		const b = await mk();
		await setRole(t.db, a, b, 'admin');
		expect(await roleOf(b)).toBe('admin');
		await setRole(t.db, a, b, 'user');
		expect(await roleOf(b)).toBe('user');
	});

	it('rejects self-demote and self-deactivate', async () => {
		const a = await mk(undefined, 'admin');
		await mk(undefined, 'admin');
		await expect(setRole(t.db, a, a, 'user')).rejects.toBeInstanceOf(SelfChangeError);
		await expect(setActive(t.db, a, a, false)).rejects.toBeInstanceOf(SelfChangeError);
		expect(await roleOf(a)).toBe('admin');
		expect(await activeOf(a)).toBe(true);
	});

	it('rejects non-admin and deactivated-admin actors, and unknown targets', async () => {
		const plain = await mk();
		const target = await mk();
		const gone = await mk(undefined, 'admin');
		await t.db.update(users).set({ active: false }).where(eq(users.id, gone));
		const a = await mk(undefined, 'admin');
		await expect(setRole(t.db, plain, target, 'admin')).rejects.toBeInstanceOf(NotAdminError);
		await expect(setActive(t.db, plain, target, false)).rejects.toBeInstanceOf(NotAdminError);
		await expect(setRole(t.db, gone, target, 'admin')).rejects.toBeInstanceOf(NotAdminError);
		await expect(setRole(t.db, a, 99999999, 'admin')).rejects.toBeInstanceOf(UserNotFoundError);
		await expect(setActive(t.db, a, 99999999, false)).rejects.toBeInstanceOf(UserNotFoundError);
		expect(await roleOf(target)).toBe('user');
	});

	it('never lets the last active admin be demoted or deactivated', async () => {
		// With every other admin inactive, the sole active admin cannot act on themselves and
		// nobody else qualifies as an actor, so the invariant holds from every angle.
		await t.db.update(users).set({ active: false }).where(eq(users.role, 'admin'));
		const only = await mk(undefined, 'admin');
		const plain = await mk();
		await expect(setRole(t.db, only, only, 'user')).rejects.toBeInstanceOf(SelfChangeError);
		await expect(setActive(t.db, only, only, false)).rejects.toBeInstanceOf(SelfChangeError);
		await expect(setRole(t.db, plain, only, 'user')).rejects.toBeInstanceOf(NotAdminError);
		await expect(setActive(t.db, plain, only, false)).rejects.toBeInstanceOf(NotAdminError);
		expect(await roleOf(only)).toBe('admin');
		expect(await activeOf(only)).toBe(true);
		expect(new LastAdminError()).toBeInstanceOf(Error);
		await t.db.update(users).set({ active: true }).where(eq(users.role, 'admin'));
	});

	it('leaves exactly one admin when two admins demote each other at once', async () => {
		for (let i = 0; i < 5; i++) {
			await t.db.update(users).set({ role: 'user' }).where(eq(users.role, 'admin'));
			const a = await mk(undefined, 'admin');
			const b = await mk(undefined, 'admin');
			const results = await Promise.allSettled([
				setRole(t.db, a, b, 'user'),
				setRole(t.db, b, a, 'user')
			]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const admins = await t.db.select().from(users).where(eq(users.role, 'admin'));
			expect(admins).toHaveLength(1);
		}
	});

	it('leaves one active admin when two admins deactivate each other at once', async () => {
		await t.db.update(users).set({ role: 'user' }).where(eq(users.role, 'admin'));
		const a = await mk(undefined, 'admin');
		const b = await mk(undefined, 'admin');
		await Promise.allSettled([setActive(t.db, a, b, false), setActive(t.db, b, a, false)]);
		const admins = await t.db.select().from(users).where(eq(users.role, 'admin'));
		expect(admins.filter((u) => u.active)).toHaveLength(1);
	});

	it('deactivation kills sessions and unused reset tokens; reactivation flips the flag', async () => {
		const a = await mk(undefined, 'admin');
		const name = `victim${++seq}`;
		const v = await mk(name);
		const otherName = `bystander${++seq}`;
		const other = await mk(otherName);
		await login(t.db, name, PW);
		await login(t.db, name, PW);
		await createResetToken(t.db, a, v);
		await createResetToken(t.db, a, other);
		await login(t.db, otherName, PW);

		await setActive(t.db, a, v, false);
		expect(await activeOf(v)).toBe(false);
		expect(await t.db.select().from(sessions).where(eq(sessions.userId, v))).toHaveLength(0);
		expect(await t.db.select().from(resetTokens).where(eq(resetTokens.userId, v))).toHaveLength(0);
		expect(await t.db.select().from(sessions).where(eq(sessions.userId, other))).toHaveLength(1);
		expect(
			await t.db.select().from(resetTokens).where(eq(resetTokens.userId, other))
		).toHaveLength(1);

		await setActive(t.db, a, v, true);
		expect(await activeOf(v)).toBe(true);
	});
});

describe('deletePeriodImages', () => {
	const fileName = () => `${randomBytes(16).toString('hex')}.webp`;

	async function setup() {
		const u1 = await mk();
		const u2 = await mk();
		await t.db
			.update(periods)
			.set({ status: 'ended', endsAt: new Date() })
			.where(eq(periods.status, 'active'));
		const period = await createPeriod(t.db, `p${++seq}`);
		const f1 = fileName();
		const f2 = fileName();
		await writeFile(join(dir, f1), 'a');
		await writeFile(join(dir, f2), 'b');
		const base = { taskKey: 'dishwasher', periodId: period.id, status: 'approved' } as const;
		const [s1] = await t.db
			.insert(submissions)
			.values({ ...base, userId: u1, pointsAwarded: 10, imagePath: f1 })
			.returning();
		const [s2] = await t.db
			.insert(submissions)
			.values({ ...base, userId: u2, pointsAwarded: 4, imagePath: f2 })
			.returning();
		await createMilestonePost(t.db, s1);
		return { period, s1, s2, f1, f2, u1 };
	}

	it('removes files, nulls paths, hides the milestone image and keeps points and winners', async () => {
		const { period, s1, s2, f1, f2, u1 } = await setup();
		await endPeriod(t.db, period.id);
		const boardBefore = await getLeaderboard(t.db, period.id);
		const winnersBefore = await t.db
			.select()
			.from(periodWinners)
			.where(eq(periodWinners.periodId, period.id));
		const [postBefore] = await t.db
			.select()
			.from(posts)
			.where(eq(posts.milestoneSubmissionId, s1.id));
		expect(postBefore.imagePath).toBe(f1);

		const res = await deletePeriodImages(t.db, period.id, { uploadDir: dir });
		expect(res).toEqual({ removed: 2, failed: 0 });
		expect(existsSync(join(dir, f1))).toBe(false);
		expect(existsSync(join(dir, f2))).toBe(false);
		for (const id of [s1.id, s2.id]) {
			const row = await subOf(id);
			expect(row.imagePath).toBeNull();
			expect(row.imageRemovedAt).toBeInstanceOf(Date);
			expect(row.status).toBe('approved');
		}
		expect((await subOf(s1.id)).pointsAwarded).toBe(10);
		const [postAfter] = await t.db
			.select()
			.from(posts)
			.where(eq(posts.milestoneSubmissionId, s1.id));
		expect(postAfter.imagePath).toBeNull();
		expect(postAfter.body).toBe(postBefore.body);
		expect(await getLeaderboard(t.db, period.id)).toEqual(boardBefore);
		expect(boardBefore[0].userId).toBe(u1);
		expect(
			await t.db.select().from(periodWinners).where(eq(periodWinners.periodId, period.id))
		).toEqual(winnersBefore);

		expect(await deletePeriodImages(t.db, period.id, { uploadDir: dir })).toEqual({
			removed: 0,
			failed: 0
		});
	});

	it('refuses an active or unknown period and leaves files alone', async () => {
		const { period, f1, s1 } = await setup();
		await expect(deletePeriodImages(t.db, period.id, { uploadDir: dir })).rejects.toBeInstanceOf(
			PeriodNotEndedError
		);
		expect(existsSync(join(dir, f1))).toBe(true);
		expect((await subOf(s1.id)).imagePath).toBe(f1);
		await expect(deletePeriodImages(t.db, 987654, { uploadDir: dir })).rejects.toBeInstanceOf(
			PeriodNotEndedError
		);
	});

	it('tolerates a missing file and reports failed for one that cannot be deleted', async () => {
		const { period, s1, s2, f1, f2 } = await setup();
		await endPeriod(t.db, period.id);
		await rm(join(dir, f1)); // already gone: ENOENT is fine
		await rm(join(dir, f2)); // make f2 a non-empty directory so unlink fails
		await mkdir(join(dir, f2));
		await writeFile(join(dir, f2, 'x'), 'x');

		const res = await deletePeriodImages(t.db, period.id, { uploadDir: dir });
		expect(res).toEqual({ removed: 1, failed: 1 });
		expect((await subOf(s1.id)).imagePath).toBeNull();
		const kept = await subOf(s2.id);
		expect(kept.imagePath).toBe(f2);
		expect(kept.imageRemovedAt).toBeNull();
	});
});
