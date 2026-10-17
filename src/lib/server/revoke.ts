import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import { periods, submissions } from './db/schema';
import { deleteMilestonePost } from './feed';
import {
	PeriodClosedError,
	SubmissionNotFoundError,
	assertAdmin
} from './review';
import { sanitizeText } from './sanitize';

export { NotAdminError, PeriodClosedError, SubmissionNotFoundError } from './review';

export class NotRevocableError extends Error {
	constructor() {
		super('Only approved chores can be removed');
		this.name = 'NotRevocableError';
	}
}

export const REVOKE_REASON_MAX = 200;
const reasonSchema = z
	.string()
	.transform(sanitizeText)
	.pipe(z.string().min(1).max(REVOKE_REASON_MAX));

/**
 * An admin removes an approved chore ("it should not be logged"): the row stays for audit with
 * status 'revoked' (points_awarded is kept but only approved rows are ever summed), the person can
 * log the chore again, and a milestone's feed post goes away. Works for auto-approved chores and
 * the welcome bonus too (the once-per-user index keeps the bonus row, so it cannot be granted
 * again). The period row is read FOR SHARE, like approve: a concurrent endPeriod waits for us (and
 * computes the winners without this chore) or has already finished, in which case the period is
 * closed and nothing may change.
 */
export async function revokeSubmission(
	db: Db,
	adminId: number,
	submissionId: number,
	reason: string,
	opts: { now?: Date } = {}
): Promise<void> {
	const parsed = reasonSchema.parse(reason);
	const now = opts.now ?? new Date();
	await db.transaction(async (tx) => {
		await assertAdmin(tx, adminId);
		const [sub] = await tx
			.select()
			.from(submissions)
			.where(eq(submissions.id, submissionId))
			.for('update');
		if (!sub) throw new SubmissionNotFoundError();
		if (sub.status !== 'approved') throw new NotRevocableError();

		const [period] = sub.periodId
			? await tx.select().from(periods).where(eq(periods.id, sub.periodId)).for('share')
			: [];
		if (!period || period.status !== 'active') throw new PeriodClosedError();

		await tx
			.update(submissions)
			.set({ status: 'revoked', revokedAt: now, revokedBy: adminId, revokeReason: parsed })
			.where(eq(submissions.id, sub.id));
		await deleteMilestonePost(tx, sub.id);
	});
}
