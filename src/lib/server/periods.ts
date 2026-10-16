import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db';
import { periodWinners, periods, users } from './db/schema';
import { getLeaderboard } from './leaderboard';

export type Period = typeof periods.$inferSelect;
export type PeriodWinner = typeof periodWinners.$inferSelect;

export class ActivePeriodExistsError extends Error {
	constructor() {
		super('A period is already active');
		this.name = 'ActivePeriodExistsError';
	}
}

export class PeriodNotActiveError extends Error {
	constructor() {
		super('Period is not active');
		this.name = 'PeriodNotActiveError';
	}
}

function isUniqueViolation(err: unknown): boolean {
	let e: unknown = err;
	for (let i = 0; i < 3 && e; i++) {
		if ((e as { code?: string }).code === '23505') return true;
		e = (e as { cause?: unknown }).cause;
	}
	return false;
}

export async function getActivePeriod(db: Db): Promise<Period | null> {
	const [row] = await db.select().from(periods).where(eq(periods.status, 'active')).limit(1);
	return row ?? null;
}

/** Starts a new active period now. The partial unique index enforces "only one active". */
export async function createPeriod(db: Db, name: string): Promise<Period> {
	try {
		const [row] = await db
			.insert(periods)
			.values({ name, startsAt: new Date(), status: 'active' })
			.returning();
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) throw new ActivePeriodExistsError();
		throw err;
	}
}

/**
 * Ends an active period and records everyone tied for the top rank (with points > 0) as
 * winners, atomically. The UPDATE comes first on purpose: it takes the period row lock, which
 * conflicts with the FOR SHARE lock held by in-flight credits (see creditAutoApprovedTask), so
 * every credit either commits before the standings are computed or fails with
 * NoActivePeriodError.
 */
export async function endPeriod(db: Db, periodId: number): Promise<PeriodWinner[]> {
	return db.transaction(async (tx) => {
		const [ended] = await tx
			.update(periods)
			.set({ status: 'ended', endsAt: new Date() })
			.where(and(eq(periods.id, periodId), eq(periods.status, 'active')))
			.returning({ id: periods.id });
		if (!ended) throw new PeriodNotActiveError();

		const top = (await getLeaderboard(tx, periodId)).filter((r) => r.rank === 1);
		if (top.length === 0) return [];
		return tx
			.insert(periodWinners)
			.values(top.map((r) => ({ periodId, userId: r.userId, points: r.points, rank: 1 })))
			.returning();
	});
}

export type PastPeriod = {
	id: number;
	name: string;
	startsAt: Date;
	endsAt: Date | null;
	participants: number;
	winners: { userId: number; username: string; points: number }[];
};

/** Ended periods, newest first, with their winners and number of scoring participants. */
export async function listPastPeriods(db: Db): Promise<PastPeriod[]> {
	const ended = await db
		.select()
		.from(periods)
		.where(eq(periods.status, 'ended'))
		.orderBy(desc(periods.endsAt), desc(periods.id));
	if (ended.length === 0) return [];

	const winnerRows = await db
		.select({
			periodId: periodWinners.periodId,
			userId: periodWinners.userId,
			username: users.displayUsername,
			points: periodWinners.points
		})
		.from(periodWinners)
		.innerJoin(users, eq(users.id, periodWinners.userId))
		.where(
			inArray(
				periodWinners.periodId,
				ended.map((p) => p.id)
			)
		)
		.orderBy(asc(users.displayUsername));

	return Promise.all(
		ended.map(async (p) => ({
			id: p.id,
			name: p.name,
			startsAt: p.startsAt,
			endsAt: p.endsAt,
			participants: (await getLeaderboard(db, p.id)).length,
			winners: winnerRows
				.filter((w) => w.periodId === p.id)
				.map(({ userId, username, points }) => ({ userId, username, points }))
		}))
	);
}
