import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from './db';
import { periods, posts, resetTokens, submissions, users } from './db/schema';
import { revokeUserSessions } from './auth/session';
import { deleteUpload } from './images';
import { NotAdminError } from './review';

export { NotAdminError };

export class UserNotFoundError extends Error {
	constructor() {
		super('User not found');
		this.name = 'UserNotFoundError';
	}
}
export class SelfChangeError extends Error {
	constructor() {
		super('You cannot demote or deactivate yourself');
		this.name = 'SelfChangeError';
	}
}
export class LastAdminError extends Error {
	constructor() {
		super('The last active admin cannot be demoted or deactivated');
		this.name = 'LastAdminError';
	}
}
export class PeriodNotEndedError extends Error {
	constructor() {
		super('Proof images can only be deleted for an ended period');
		this.name = 'PeriodNotEndedError';
	}
}

// ---------------------------------------------------------------- users

export type AdminUserRow = {
	id: number;
	username: string;
	role: 'user' | 'admin';
	classification: 'Student' | 'Employee' | null;
	department: string | null;
	active: boolean;
	createdAt: Date;
	points: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Case-insensitive username search (empty q lists all); `points` is approved points in the active period. */
export async function searchUsers(
	db: Db,
	q: string,
	opts: { limit?: number } = {}
): Promise<AdminUserRow[]> {
	const asked = Number.isFinite(opts.limit) ? Math.trunc(opts.limit!) : DEFAULT_LIMIT;
	const limit = Math.min(Math.max(asked, 1), MAX_LIMIT);
	const needle = q.trim().toLowerCase().replace(/[\\%_]/g, '\\$&');
	const [active] = await db
		.select({ id: periods.id })
		.from(periods)
		.where(eq(periods.status, 'active'));

	const points = db
		.select({
			userId: submissions.userId,
			total: sql<number>`sum(${submissions.pointsAwarded})::int`.as('total')
		})
		.from(submissions)
		.where(and(eq(submissions.periodId, active?.id ?? -1), eq(submissions.status, 'approved')))
		.groupBy(submissions.userId)
		.as('pts');

	return db
		.select({
			id: users.id,
			username: users.displayUsername,
			role: users.role,
			classification: users.classification,
			department: users.department,
			active: users.active,
			createdAt: users.createdAt,
			points: sql<number>`coalesce(${points.total}, 0)::int`
		})
		.from(users)
		.leftJoin(points, eq(points.userId, users.id))
		.where(needle ? sql`${users.usernameNormalized} like ${'%' + needle + '%'}` : undefined)
		.orderBy(asc(users.usernameNormalized), asc(users.id))
		.limit(limit);
}

/**
 * Runs `fn` with the actor, the target and every admin row locked (ordered by id, so two
 * concurrent admin changes serialise instead of deadlocking) and read after any lock wait.
 */
async function withLockedAdmins<T>(
	db: Db,
	adminId: number,
	userId: number,
	fn: (tx: Tx, otherActiveAdmins: number) => Promise<T>
): Promise<T> {
	return db.transaction(async (tx) => {
		const rows = await tx
			.select({ id: users.id, role: users.role, active: users.active })
			.from(users)
			.where(or(eq(users.role, 'admin'), inArray(users.id, [adminId, userId])))
			.orderBy(asc(users.id))
			.for('update');
		const actor = rows.find((r) => r.id === adminId);
		if (!actor || actor.role !== 'admin' || !actor.active) throw new NotAdminError();
		if (!rows.some((r) => r.id === userId)) throw new UserNotFoundError();
		const others = rows.filter((r) => r.id !== userId && r.role === 'admin' && r.active).length;
		return fn(tx, others);
	});
}

export async function setRole(
	db: Db,
	adminId: number,
	userId: number,
	role: 'user' | 'admin'
): Promise<void> {
	await withLockedAdmins(db, adminId, userId, async (tx, otherActiveAdmins) => {
		if (role === 'user') {
			if (userId === adminId) throw new SelfChangeError();
			// Defensive: the actor is an active admin other than the target, so this cannot trip.
			if (otherActiveAdmins < 1) throw new LastAdminError();
		}
		await tx.update(users).set({ role }).where(eq(users.id, userId));
	});
}

export async function setActive(
	db: Db,
	adminId: number,
	userId: number,
	active: boolean
): Promise<void> {
	await withLockedAdmins(db, adminId, userId, async (tx, otherActiveAdmins) => {
		if (!active) {
			if (userId === adminId) throw new SelfChangeError();
			if (otherActiveAdmins < 1) throw new LastAdminError();
		}
		await tx.update(users).set({ active }).where(eq(users.id, userId));
		if (!active) {
			await revokeUserSessions(tx, userId);
			await tx
				.delete(resetTokens)
				.where(and(eq(resetTokens.userId, userId), isNull(resetTokens.usedAt)));
		}
	});
}

// ---------------------------------------------------------------- image retention

const BATCH = 100;

/**
 * Deletes the stored proof images of an ended period. Per submission the file goes first and the
 * DB row is only cleared after that succeeded (ENOENT counts as success), so the DB never points
 * at a file we failed to handle. Points, status, leaderboard and winners are untouched.
 */
export async function deletePeriodImages(
	db: Db,
	periodId: number,
	opts: { uploadDir?: string } = {}
): Promise<{ removed: number; failed: number }> {
	const [period] = await db
		.select({ status: periods.status })
		.from(periods)
		.where(eq(periods.id, periodId));
	if (period?.status !== 'ended') throw new PeriodNotEndedError();

	let removed = 0;
	let failed = 0;
	let lastId = 0;
	for (;;) {
		const batch = await db
			.select({ id: submissions.id, imagePath: submissions.imagePath })
			.from(submissions)
			.where(
				and(
					eq(submissions.periodId, periodId),
					isNotNull(submissions.imagePath),
					gt(submissions.id, lastId)
				)
			)
			.orderBy(asc(submissions.id))
			.limit(BATCH);
		if (batch.length === 0) break;
		lastId = batch[batch.length - 1].id;

		for (const row of batch) {
			const file = row.imagePath!;
			try {
				await deleteUpload(file, { dir: opts.uploadDir });
			} catch {
				failed++;
				continue;
			}
			await db.transaction(async (tx) => {
				await tx
					.update(submissions)
					.set({ imagePath: null, imageRemovedAt: new Date() })
					.where(and(eq(submissions.id, row.id), eq(submissions.imagePath, file)));
				await tx
					.update(posts)
					.set({ imagePath: null })
					.where(eq(posts.milestoneSubmissionId, row.id));
			});
			removed++;
		}
	}
	return { removed, failed };
}
