import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from './db';
import { events, submissions, tasks, users } from './db/schema';
import { getActivePeriod } from './periods';

export type Submission = typeof submissions.$inferSelect;
export type Task = typeof tasks.$inferSelect;

export class NoActivePeriodError extends Error {
	constructor() {
		super('No active period');
		this.name = 'NoActivePeriodError';
	}
}

export class CooldownError extends Error {
	constructor(public retryAfterSeconds: number) {
		super(`Try again in ${retryAfterSeconds}s`);
		this.name = 'CooldownError';
	}
}

export class UnknownTaskError extends Error {
	constructor(key: string) {
		super(`Unknown task: ${key}`);
		this.name = 'UnknownTaskError';
	}
}

export class TaskRequiresReviewError extends Error {
	constructor(key: string) {
		super(`Task ${key} requires review`);
		this.name = 'TaskRequiresReviewError';
	}
}

export class InactiveUserError extends Error {
	constructor() {
		super('User is not active');
		this.name = 'InactiveUserError';
	}
}

export type LogOptions = { now?: Date; imagePath?: string };

/**
 * Seconds until `lastAt + cooldownSeconds`, ceil-ed; 0 if the cooldown has elapsed
 * (exactly at the boundary counts as elapsed).
 */
export function cooldownRemainingSeconds(lastAt: Date, cooldownSeconds: number, now: Date): number {
	const remainingMs = lastAt.getTime() + cooldownSeconds * 1000 - now.getTime();
	return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * Cooldown check + approved-submission insert for a task that needs no review, serialised
 * per (user, task) with a transaction-scoped advisory lock. Shared by logTask and the
 * cutlery photo flow.
 */
export async function creditAutoApprovedTask(
	db: Db,
	userId: number,
	task: Task,
	opts: LogOptions = {}
): Promise<Submission> {
	const now = opts.now ?? new Date();
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`task:${userId}:${task.key}`}, 0))`
		);

		const [user] = await tx.select({ active: users.active }).from(users).where(eq(users.id, userId));
		if (!user?.active) throw new InactiveUserError();

		const period = await getActivePeriod(tx as unknown as Db);
		if (!period) throw new NoActivePeriodError();

		const [last] = await tx
			.select({ createdAt: submissions.createdAt })
			.from(submissions)
			.where(
				and(
					eq(submissions.userId, userId),
					eq(submissions.taskKey, task.key),
					ne(submissions.status, 'rejected')
				)
			)
			.orderBy(desc(submissions.createdAt))
			.limit(1);
		if (last) {
			const remaining = cooldownRemainingSeconds(last.createdAt, task.cooldownSeconds, now);
			if (remaining > 0) throw new CooldownError(remaining);
		}

		const [row] = await tx
			.insert(submissions)
			.values({
				userId,
				taskKey: task.key,
				periodId: period.id,
				status: 'approved',
				pointsAwarded: task.points,
				imagePath: opts.imagePath ?? null,
				createdAt: now
			})
			.returning();
		await tx.insert(events).values({ userId, type: 'task_submitted', createdAt: now });
		return row;
	});
}

/** Logs a self-reported (no-review) task and credits its points immediately. */
export async function logTask(
	db: Db,
	userId: number,
	taskKey: string,
	opts: LogOptions = {}
): Promise<Submission> {
	const [task] = await db.select().from(tasks).where(eq(tasks.key, taskKey));
	if (!task) throw new UnknownTaskError(taskKey);
	if (task.needsReview) throw new TaskRequiresReviewError(taskKey);
	return creditAutoApprovedTask(db, userId, task, opts);
}

/** Seconds of cooldown the user still has on a task (0 if free). */
export async function getCooldownRemaining(
	db: Db,
	userId: number,
	task: Task,
	now: Date = new Date()
): Promise<number> {
	if (task.cooldownSeconds <= 0) return 0;
	const [last] = await db
		.select({ createdAt: submissions.createdAt })
		.from(submissions)
		.where(
			and(
				eq(submissions.userId, userId),
				eq(submissions.taskKey, task.key),
				ne(submissions.status, 'rejected')
			)
		)
		.orderBy(desc(submissions.createdAt))
		.limit(1);
	return last ? cooldownRemainingSeconds(last.createdAt, task.cooldownSeconds, now) : 0;
}

/** The user's approved points in a period. */
export async function getUserPeriodTotal(db: Db, userId: number, periodId: number): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${submissions.pointsAwarded}), 0)::int` })
		.from(submissions)
		.where(
			and(
				eq(submissions.userId, userId),
				eq(submissions.periodId, periodId),
				eq(submissions.status, 'approved')
			)
		);
	return row.total;
}
