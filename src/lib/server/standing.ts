import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from './db';
import { submissions, tasks, users } from './db/schema';
import { getLeaderboard } from './leaderboard';
import { WELCOME_BONUS_KEY } from './welcomeBonus';

export type Standing = {
	points: number;
	/** Tie-aware rank (1,1,3); null while the user has no approved points in the period. */
	rank: number | null;
	/** People on the board: ranked users (approved points > 0, deactivated excluded). */
	ofTotal: number;
	/** Points between the user and first place; 0 when the user is in (or shares) first place. */
	behindFirst: number;
	/** How many people hold first place (more than 1 means a tie); 0 on an empty board. */
	leaders: number;
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
		behindFirst: mine ? first - mine.points : first,
		leaders: board.filter((r) => r.rank === 1).length
	};
}

export type ActivityItem = {
	id: number;
	username: string;
	taskLabel: string;
	taskKey: string;
	at: Date;
};

/**
 * Latest approved (including auto-approved) chores of a period, newest first. No images. The
 * welcome bonus is private to its user and never listed here.
 */
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
				ne(submissions.taskKey, WELCOME_BONUS_KEY),
				eq(users.active, true)
			)
		)
		.orderBy(desc(submissions.createdAt), desc(submissions.id))
		.limit(Math.max(0, Math.floor(limit)));
}
