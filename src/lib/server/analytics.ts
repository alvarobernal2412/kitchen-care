import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from './db';
import { submissions, tasks } from './db/schema';
import { getLeaderboard } from './leaderboard';
import { WELCOME_BONUS_KEY } from './welcomeBonus';

export class InvalidRangeError extends Error {
	constructor(message = 'Invalid range') {
		super(message);
		this.name = 'InvalidRangeError';
	}
}

const DAY_MS = 86_400_000;
export const MAX_DAY_SPAN_DAYS = 400;
export const MAX_WEEK_SPAN_DAYS = 1830;

let warnedTz: string | undefined;

/** A valid IANA timezone name, or 'UTC' (with a one-off warning for a bad non-empty value). */
export function resolveTimezone(name: string | undefined | null): string {
	if (!name) return 'UTC';
	try {
		new Intl.DateTimeFormat('en', { timeZone: name });
		return name;
	} catch {
		if (warnedTz !== name) {
			warnedTz = name;
			console.warn(`Invalid APP_TIMEZONE "${name}", falling back to UTC`);
		}
		return 'UTC';
	}
}

/** The timezone all analytics bucketing uses: APP_TIMEZONE, default UTC. */
export function getAppTimezone(): string {
	return resolveTimezone(process.env.APP_TIMEZONE);
}

function assertRange(from: Date, to: Date, maxDays: number): void {
	if (!(from instanceof Date) || !(to instanceof Date) || isNaN(+from) || isNaN(+to)) {
		throw new InvalidRangeError('Range dates must be valid');
	}
	if (from >= to) throw new InvalidRangeError('Range start must be before its end');
	if ((+to - +from) / DAY_MS > maxDays) {
		throw new InvalidRangeError(`Range may span at most ${maxDays} days`);
	}
}

export type ActivityRange = { from: Date; to: Date; bucket: 'day' | 'week'; tz?: string };
export type ActivityPoint = {
	bucket: string;
	opens: number;
	activeUsers: number;
	submissions: number;
};

/**
 * Per-bucket activity over [from, to): app opens, distinct active users (any event) and
 * task submissions. Buckets are calendar days / Monday-started weeks in `tz`, generated as
 * local (timezone-less) timestamps so DST days stay single buckets; empty buckets are zeros.
 */
export async function getActivity(
	db: Pick<Db, 'execute'>,
	range: ActivityRange
): Promise<ActivityPoint[]> {
	const { from, to, bucket } = range;
	if (bucket !== 'day' && bucket !== 'week') throw new InvalidRangeError('Unknown bucket');
	assertRange(from, to, bucket === 'day' ? MAX_DAY_SPAN_DAYS : MAX_WEEK_SPAN_DAYS);
	const tz = resolveTimezone(range.tz);
	const f = from.toISOString();
	const t = to.toISOString();
	const step = bucket === 'day' ? '1 day' : '7 days';

	const rows = await db.execute<{
		bucket: string;
		opens: number;
		active_users: number;
		submissions: number;
	}>(sql`
		with series as (
			select generate_series(
				date_trunc(${bucket}::text, ${f}::timestamptz at time zone ${tz}::text),
				date_trunc(${bucket}::text, (${t}::timestamptz - interval '1 millisecond') at time zone ${tz}::text),
				${step}::interval
			) as start
		),
		agg as (
			select
				date_trunc(${bucket}::text, created_at at time zone ${tz}::text) as start,
				count(*) filter (where type = 'app_open')::int as opens,
				count(distinct user_id)::int as active_users,
				count(*) filter (where type = 'task_submitted')::int as submissions
			from events
			where created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz
			group by 1
		)
		select
			to_char(series.start, 'YYYY-MM-DD') as bucket,
			coalesce(agg.opens, 0) as opens,
			coalesce(agg.active_users, 0) as active_users,
			coalesce(agg.submissions, 0) as submissions
		from series
		left join agg on agg.start = series.start
		order by series.start
	`);
	return rows.map((r) => ({
		bucket: r.bucket,
		opens: r.opens,
		activeUsers: r.active_users,
		submissions: r.submissions
	}));
}

/** Totals over [from, to); activeUsers is distinct over the whole range. */
export async function getRangeTotals(
	db: Pick<Db, 'execute'>,
	range: { from: Date; to: Date }
): Promise<{ opens: number; activeUsers: number; submissions: number }> {
	assertRange(range.from, range.to, 3660);
	const [row] = await db.execute<{ opens: number; active_users: number; submissions: number }>(sql`
		select
			(count(*) filter (where type = 'app_open'))::int as opens,
			count(distinct user_id)::int as active_users,
			(count(*) filter (where type = 'task_submitted'))::int as submissions
		from events
		where created_at >= ${range.from.toISOString()}::timestamptz
			and created_at < ${range.to.toISOString()}::timestamptz
	`);
	return { opens: row.opens, activeUsers: row.active_users, submissions: row.submissions };
}

/**
 * 7x24 matrix [weekday Mon=0..Sun=6][hour 0..23] of task_submitted events in [from, to),
 * in `tz`. Always the full shape, zero-filled.
 */
export async function getHeatmap(
	db: Pick<Db, 'execute'>,
	range: { from: Date; to: Date; tz?: string }
): Promise<number[][]> {
	assertRange(range.from, range.to, 3660);
	const tz = resolveTimezone(range.tz);
	const rows = await db.execute<{ dow: number; hour: number; n: number }>(sql`
		select
			(extract(isodow from created_at at time zone ${tz}::text)::int - 1) as dow,
			extract(hour from created_at at time zone ${tz}::text)::int as hour,
			count(*)::int as n
		from events
		where type = 'task_submitted'
			and created_at >= ${range.from.toISOString()}::timestamptz
			and created_at < ${range.to.toISOString()}::timestamptz
		group by 1, 2
	`);
	const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	for (const r of rows) matrix[r.dow][r.hour] = r.n;
	return matrix;
}

export const DEFAULT_CONTRIBUTORS = 10;
export const MAX_CONTRIBUTORS = 50;

/**
 * Top earners of a period, reusing the leaderboard ranking (approved, active users only).
 * `tasks` counts chores: the welcome bonus adds points but is not a task.
 */
export async function getTopContributors(
	db: Pick<Db, 'select'>,
	periodId: number,
	opts: { limit?: number } = {}
): Promise<
	{ userId: number; username: string; avatarPath: string | null; points: number; tasks: number }[]
> {
	const asked = opts.limit;
	const limit =
		asked !== undefined && Number.isFinite(asked) && asked >= 1
			? Math.min(Math.floor(asked), MAX_CONTRIBUTORS)
			: DEFAULT_CONTRIBUTORS;
	const top = (await getLeaderboard(db, periodId)).slice(0, limit);
	if (top.length === 0) return [];
	const counts = await db
		.select({ userId: submissions.userId, n: sql<number>`count(*)::int` })
		.from(submissions)
		.where(
			and(
				eq(submissions.periodId, periodId),
				eq(submissions.status, 'approved'),
				ne(submissions.taskKey, WELCOME_BONUS_KEY),
				inArray(
					submissions.userId,
					top.map((r) => r.userId)
				)
			)
		)
		.groupBy(submissions.userId);
	const byUser = new Map(counts.map((c) => [c.userId, c.n]));
	return top.map((r) => ({
		userId: r.userId,
		username: r.username,
		avatarPath: r.avatar,
		points: r.points,
		tasks: byUser.get(r.userId) ?? 0
	}));
}

/** Approved submissions per chore in a period; every chore is listed, zeros included. */
export async function getTaskDistribution(
	db: Pick<Db, 'select'>,
	periodId: number
): Promise<{ taskKey: string; label: string; count: number; points: number }[]> {
	const count = sql<number>`count(${submissions.id})::int`;
	return db
		.select({
			taskKey: tasks.key,
			label: tasks.label,
			count,
			points: sql<number>`coalesce(sum(${submissions.pointsAwarded}), 0)::int`
		})
		.from(tasks)
		.leftJoin(
			submissions,
			and(
				eq(submissions.taskKey, tasks.key),
				eq(submissions.periodId, periodId),
				eq(submissions.status, 'approved')
			)
		)
		.where(ne(tasks.key, WELCOME_BONUS_KEY))
		.groupBy(tasks.key, tasks.label)
		.orderBy(desc(count), asc(tasks.label));
}
