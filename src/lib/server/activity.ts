import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { escapeLike } from './admin';
import { submissions, tasks, users } from './db/schema';

export const ACTIVITY_PAGE_SIZE = 25;

export type ActivityFilter = {
	/** Case-insensitive username substring (LIKE wildcards are literal). */
	user?: string;
	taskKey?: string;
	/** Also list chores an admin already removed. */
	includeRemoved?: boolean;
	/** Keyset cursor: only submissions with a smaller id. */
	beforeId?: number;
};

export type ActivityRow = {
	id: number;
	status: 'approved' | 'revoked';
	taskKey: string;
	taskLabel: string;
	points: number;
	imagePath: string | null;
	createdAt: Date;
	userId: number;
	username: string;
	avatarPath: string | null;
	revokedAt: Date | null;
	revokedByUsername: string | null;
	revokeReason: string | null;
};

/**
 * Approved chores (and, on request, removed ones) of one period, newest first, one page at a
 * time. The admin's "Activity" screen; removal itself is revokeSubmission.
 */
export async function listPeriodActivity(
	db: Db,
	periodId: number,
	filter: ActivityFilter = {}
): Promise<{ items: ActivityRow[]; next: number | null }> {
	const conds: SQL[] = [
		eq(submissions.periodId, periodId),
		inArray(submissions.status, filter.includeRemoved ? ['approved', 'revoked'] : ['approved'])
	];
	if (filter.taskKey) conds.push(eq(submissions.taskKey, filter.taskKey));
	if (filter.beforeId !== undefined) conds.push(lt(submissions.id, filter.beforeId));
	const needle = filter.user ? escapeLike(filter.user) : '';
	if (needle) conds.push(sql`${users.usernameNormalized} like ${'%' + needle + '%'}`);

	const remover = db
		.select({ id: users.id, username: users.displayUsername })
		.from(users)
		.as('remover');
	const rows = await db
		.select({
			id: submissions.id,
			status: submissions.status,
			taskKey: submissions.taskKey,
			taskLabel: tasks.label,
			points: submissions.pointsAwarded,
			imagePath: submissions.imagePath,
			createdAt: submissions.createdAt,
			userId: users.id,
			username: users.displayUsername,
			avatarPath: users.avatarPath,
			revokedAt: submissions.revokedAt,
			revokedByUsername: remover.username,
			revokeReason: submissions.revokeReason
		})
		.from(submissions)
		.innerJoin(users, eq(users.id, submissions.userId))
		.innerJoin(tasks, eq(tasks.key, submissions.taskKey))
		.leftJoin(remover, eq(remover.id, submissions.revokedBy))
		.where(and(...conds))
		.orderBy(desc(submissions.id))
		.limit(ACTIVITY_PAGE_SIZE + 1);
	const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
	return {
		items: page.map((r) => ({ ...r, status: r.status as 'approved' | 'revoked' })),
		next: rows.length > ACTIVITY_PAGE_SIZE ? page[page.length - 1].id : null
	};
}
