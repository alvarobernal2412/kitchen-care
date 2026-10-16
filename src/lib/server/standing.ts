import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './db';
import { submissions, tasks, users } from './db/schema';
import { getLeaderboard } from './leaderboard';

export type Standing = {
	points: number;
	/** Tie-aware rank (1,1,3); null while the user has no approved points in the period. */
	rank: number | null;
	/** People on the board: ranked users (approved points > 0, deactivated excluded). */
	ofTotal: number;
	/** Points between the user and first place; 0 when the user is in (or shares) first place. */
	behindFirst: number;
};

/**
 * The user's place in a period, with the leaderboard's rules because it is derived from
 * getLeaderboard (approved only, deactivated users hidden, ties share a rank). A user with no
 * points is not on the board: rank null, points 0, and the gap is first place's points.
 */
export async function getUserStanding(
	db: Db,
	userId: number,
	periodId: number
): Promise<Standing> {
	const board = await getLeaderboard(db, periodId);
	const mine = board.find((r) => r.userId === userId);
	const first = board[0]?.points ?? 0;
	return {
		points: mine?.points ?? 0,
		rank: mine?.rank ?? null,
		ofTotal: board.length,
		behindFirst: mine ? first - mine.points : first
	};
}

export type ActivityItem = {
	id: number;
	username: string;
	taskLabel: string;
	taskKey: string;
	at: Date;
};

/** Latest approved (including auto-approved) entries of a period, newest first. No images. */
export async function listRecentActivity(
	db: Db,
	periodId: number,
	limit = 8
): Promise<ActivityItem[]> {
	return db
		.select({
			id: submissions.id,
			username: users.displayUsername,
			taskLabel: tasks.label,
			taskKey: submissions.taskKey,
			at: submissions.createdAt
		})
		.from(submissions)
		.innerJoin(users, eq(users.id, submissions.userId))
		.innerJoin(tasks, eq(tasks.key, submissions.taskKey))
		.where(
			and(
				eq(submissions.periodId, periodId),
				eq(submissions.status, 'approved'),
				eq(users.active, true)
			)
		)
		.orderBy(desc(submissions.createdAt), desc(submissions.id))
		.limit(Math.max(0, Math.floor(limit)));
}
