import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { periods } from './db/schema';

export type Period = typeof periods.$inferSelect;

export class ActivePeriodExistsError extends Error {
	constructor() {
		super('A period is already active');
		this.name = 'ActivePeriodExistsError';
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
