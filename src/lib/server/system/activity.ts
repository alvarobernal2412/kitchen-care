import { sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';

export type ActivityInfo = {
	usersActive: number;
	usersTotal: number;
	liveSessions: number;
	pendingSubmissions: number;
	eventsLast24h: number;
	submissionsLast24h: number;
	posts: number;
	comments: number;
};

/**
 * Informational counters (no status). One round trip of scalar sub-selects; the tables are small.
 * Pending submissions use submissions_period_status_idx's status column; `events` and
 * `submissions` are filtered on created_at, which is fine at this scale.
 */
export async function collectActivity(db: Db): Promise<ActivityInfo> {
	const [r] = await db.execute(sql`
		select
			(select count(*) from users where active)::int as users_active,
			(select count(*) from users)::int as users_total,
			(select count(*) from sessions where expires_at > now())::int as live_sessions,
			(select count(*) from submissions where status = 'pending')::int as pending_submissions,
			(select count(*) from events where created_at > now() - interval '24 hours')::int as events_24h,
			(select count(*) from submissions where created_at > now() - interval '24 hours')::int as submissions_24h,
			(select count(*) from posts)::int as posts,
			(select count(*) from comments)::int as comments
	`);
	return {
		usersActive: Number(r.users_active),
		usersTotal: Number(r.users_total),
		liveSessions: Number(r.live_sessions),
		pendingSubmissions: Number(r.pending_submissions),
		eventsLast24h: Number(r.events_24h),
		submissionsLast24h: Number(r.submissions_24h),
		posts: Number(r.posts),
		comments: Number(r.comments)
	};
}
