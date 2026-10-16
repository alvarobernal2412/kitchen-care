import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { submissions, tasks } from '$lib/server/db/schema';
import { getActivePeriod } from '$lib/server/periods';
import { getUserStanding, listRecentActivity } from '$lib/server/standing';
import { getCooldownRemaining } from '$lib/server/tasks';
import type { PageServerLoad } from './$types';

/** Tile order on Home: quick chores first, the big photo-reviewed ones last. */
const TILE_ORDER = ['cutlery', 'dishwasher', 'grounds', 'milk', 'beans', 'descale', 'deep_clean'];

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // guaranteed by the (app) layout load
	const db = getDb();
	const now = new Date();
	const [period, allTasks] = await Promise.all([getActivePeriod(db), db.select().from(tasks)]);

	const pendingRows = await db
		.select({ taskKey: submissions.taskKey, count: sql<number>`count(*)::int` })
		.from(submissions)
		.where(and(eq(submissions.userId, user.id), eq(submissions.status, 'pending')))
		.groupBy(submissions.taskKey);
	const pendingByTask = new Map(pendingRows.map((r) => [r.taskKey, r.count]));

	const ordered = TILE_ORDER.map((key) => allTasks.find((t) => t.key === key)).filter(
		(t) => t !== undefined
	);
	const tiles = await Promise.all(
		ordered.map(async (task) => ({
			key: task.key,
			label: task.label,
			points: task.points,
			needsPhoto: task.requiresPhoto,
			needsReview: task.needsReview,
			cooldownSeconds: task.cooldownSeconds,
			retryAfterSeconds: await getCooldownRemaining(db, user.id, task, now),
			pendingCount: pendingByTask.get(task.key) ?? 0
		}))
	);

	const [standing, activity] = period
		? await Promise.all([
				getUserStanding(db, user.id, period.id),
				listRecentActivity(db, period.id, 8)
			])
		: [null, []];

	const recent = await db
		.select({
			id: submissions.id,
			label: tasks.label,
			status: submissions.status,
			rejectReason: submissions.rejectReason,
			points: submissions.pointsAwarded,
			createdAt: submissions.createdAt
		})
		.from(submissions)
		.innerJoin(tasks, eq(tasks.key, submissions.taskKey))
		.where(eq(submissions.userId, user.id))
		.orderBy(desc(submissions.createdAt), desc(submissions.id))
		.limit(10);

	return {
		period: period ? { name: period.name } : null,
		total: standing?.points ?? 0,
		standing,
		tiles,
		activity: activity.map((a) => ({ ...a, at: a.at.toISOString() })),
		recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
	};
};
