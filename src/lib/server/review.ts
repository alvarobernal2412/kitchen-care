import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './db';
import { deleteUpload } from './images';
import { periods, submissions, tasks, users } from './db/schema';
import type { Submission } from './tasks';

export class NotAdminError extends Error {
	constructor() {
		super('Only active admins can review submissions');
		this.name = 'NotAdminError';
	}
}

export class SubmissionNotFoundError extends Error {
	constructor() {
		super('Submission not found');
		this.name = 'SubmissionNotFoundError';
	}
}

export class AlreadyReviewedError extends Error {
	constructor() {
		super('Submission was already reviewed');
		this.name = 'AlreadyReviewedError';
	}
}

export class PeriodClosedError extends Error {
	constructor() {
		super("The submission's period has ended");
		this.name = 'PeriodClosedError';
	}
}

export const REJECT_REASON_MAX = 200;
const reasonSchema = z.string().trim().min(1).max(REJECT_REASON_MAX);

export type ApproveOptions = {
	onMilestone?: (submission: Submission, tx: Tx) => Promise<void>;
	now?: Date;
};

export async function assertAdmin(tx: Pick<Db, 'select'>, adminId: number) {
	const [a] = await tx
		.select({ role: users.role, active: users.active })
		.from(users)
		.where(eq(users.id, adminId));
	if (!a || a.role !== 'admin' || !a.active) throw new NotAdminError();
}

async function lockPending(tx: Tx, submissionId: number): Promise<Submission> {
	const [sub] = await tx
		.select()
		.from(submissions)
		.where(eq(submissions.id, submissionId))
		.for('update');
	if (!sub) throw new SubmissionNotFoundError();
	if (sub.status !== 'pending') throw new AlreadyReviewedError();
	return sub;
}

export async function approve(
	db: Db,
	adminId: number,
	submissionId: number,
	opts: ApproveOptions = {}
): Promise<void> {
	const now = opts.now ?? new Date();
	await db.transaction(async (tx) => {
		await assertAdmin(tx, adminId);
		const sub = await lockPending(tx, submissionId);

		// FOR SHARE on the period row: a concurrent endPeriod UPDATE waits for us, and once it has
		// committed we see status = 'ended' here. Ended periods never receive credits.
		const [period] = sub.periodId
			? await tx.select().from(periods).where(eq(periods.id, sub.periodId)).for('share')
			: [];
		if (!period || period.status !== 'active') throw new PeriodClosedError();

		const [task] = await tx.select().from(tasks).where(eq(tasks.key, sub.taskKey));
		const [updated] = await tx
			.update(submissions)
			.set({
				status: 'approved',
				pointsAwarded: task.points,
				reviewedAt: now,
				reviewedBy: adminId
			})
			.where(eq(submissions.id, sub.id))
			.returning();

		if (task.milestone && opts.onMilestone) await opts.onMilestone(updated, tx);
	});
}

export async function reject(
	db: Db,
	adminId: number,
	submissionId: number,
	reason: string,
	opts: { uploadDir?: string; now?: Date } = {}
): Promise<void> {
	const parsed = reasonSchema.parse(reason);
	const now = opts.now ?? new Date();
	const imagePath = await db.transaction(async (tx) => {
		await assertAdmin(tx, adminId);
		const sub = await lockPending(tx, submissionId);
		await tx
			.update(submissions)
			.set({ status: 'rejected', rejectReason: parsed, reviewedAt: now, reviewedBy: adminId })
			.where(eq(submissions.id, sub.id));
		return sub.imagePath;
	});
	// Only after commit: the proof is no longer needed once the decision is recorded.
	if (imagePath) await deleteUpload(imagePath, { dir: opts.uploadDir }).catch(() => {});
}

/** Pending review queue, oldest first. */
export async function listPending(db: Db) {
	return db
		.select({
			id: submissions.id,
			taskKey: submissions.taskKey,
			taskLabel: tasks.label,
			imagePath: submissions.imagePath,
			createdAt: submissions.createdAt,
			username: users.displayUsername
		})
		.from(submissions)
		.innerJoin(tasks, eq(tasks.key, submissions.taskKey))
		.innerJoin(users, eq(users.id, submissions.userId))
		.where(eq(submissions.status, 'pending'))
		.orderBy(asc(submissions.createdAt), asc(submissions.id));
}
