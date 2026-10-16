import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { submissions, users } from './db/schema';

export type LeaderboardFilter = {
	classification?: 'Student' | 'Employee';
	department?: string;
};

export type LeaderboardRow = {
	userId: number;
	username: string;
	avatar: string | null;
	classification: string | null;
	department: string | null;
	points: number;
	rank: number;
};

/**
 * Standings for a period: approved points only, users with 0 points omitted, ties share a
 * rank (RANK(), so 1,1,3). Filters apply before ranking. Deactivated users are hidden from
 * every board (active or ended) so the live board always matches the winners recorded at end.
 */
export async function getLeaderboard(
	db: Pick<Db, 'select'>,
	periodId: number,
	filter: LeaderboardFilter = {}
): Promise<LeaderboardRow[]> {
	const conds: SQL[] = [
		eq(submissions.periodId, periodId),
		eq(submissions.status, 'approved'),
		eq(users.active, true)
	];
	if (filter.classification) conds.push(eq(users.classification, filter.classification));
	if (filter.department) conds.push(eq(users.department, sql`${filter.department}`));

	const points = sql<number>`sum(${submissions.pointsAwarded})::int`;
	const agg = db
		.select({
			userId: users.id,
			username: users.displayUsername,
			avatar: users.avatarPath,
			classification: users.classification,
			department: users.department,
			points: points.as('points')
		})
		.from(submissions)
		.innerJoin(users, eq(users.id, submissions.userId))
		.where(and(...conds))
		.groupBy(
			users.id,
			users.displayUsername,
			users.avatarPath,
			users.classification,
			users.department
		)
		.having(sql`sum(${submissions.pointsAwarded}) > 0`)
		.as('agg');

	return db
		.select({
			userId: agg.userId,
			username: agg.username,
			avatar: agg.avatar,
			classification: agg.classification,
			department: agg.department,
			points: agg.points,
			rank: sql<number>`rank() over (order by ${agg.points} desc)::int`
		})
		.from(agg)
		.orderBy(desc(agg.points), asc(agg.username));
}
