import { desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { submissions, tasks } from '$lib/server/db/schema';
import { getActivePeriod } from '$lib/server/periods';
import { getCooldownRemaining, getUserPeriodTotal } from '$lib/server/tasks';
import type { PageServerLoad } from './$types';

const SELF_REPORTED = ['dishwasher', 'grounds'];
const PHOTO_TASKS = ['cutlery', 'beans', 'milk', 'descale', 'deep_clean'];

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // guaranteed by the (app) layout load
	const db = getDb();
	const now = new Date();
	const [period, allTasks] = await Promise.all([getActivePeriod(db), db.select().from(tasks)]);
	const total = period ? await getUserPeriodTotal(db, user.id, period.id) : 0;

	const toItem = async (key: string) => {
		const task = allTasks.find((t) => t.key === key);
		if (!task) return null;
		return {
			key: task.key,
			label: task.label,
			points: task.points,
			retryAfterSeconds: await getCooldownRemaining(db, user.id, task, now)
		};
	};
	const selfReported = (await Promise.all(SELF_REPORTED.map(toItem))).filter((t) => t !== null);
	const photoTasks = (await Promise.all(PHOTO_TASKS.map(toItem))).filter((t) => t !== null);

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
		total,
		selfReported,
		photoTasks,
		recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
	};
};
