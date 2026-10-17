import { eq } from 'drizzle-orm';
import type { Db, Executor } from './db';
import { periods, submissions } from './db/schema';
import { getAppTimezone } from './analytics';

/** Task key of the one-time welcome bonus. It is a ledger entry, never a chore. */
export const WELCOME_BONUS_KEY = 'welcome_bonus';
export const WELCOME_BONUS_POINTS = 10;

/** Strictly before 20 November 2026, 00:00 in Europe/Zurich (CET, UTC+1). */
export const DEFAULT_WELCOME_BONUS_UNTIL = new Date('2026-11-20T00:00:00+01:00');

// ISO-8601 date-time that carries an explicit offset (or Z); a bare local time is ambiguous.
const ISO_WITH_OFFSET =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const warned = new Set<string>();

/**
 * The last moment (exclusive) at which a signup still earns the bonus: `env` (normally
 * WELCOME_BONUS_UNTIL) when it is a valid ISO-8601 timestamp with an offset, otherwise the
 * default. An empty value means "use the default" silently; an invalid one logs one warning
 * per distinct value.
 */
export function welcomeBonusDeadline(env: string | undefined = process.env.WELCOME_BONUS_UNTIL): Date {
	const raw = env?.trim();
	if (!raw) return DEFAULT_WELCOME_BONUS_UNTIL;
	const ms = ISO_WITH_OFFSET.test(raw) ? Date.parse(raw) : NaN;
	if (Number.isNaN(ms)) {
		if (!warned.has(raw)) {
			warned.add(raw);
			console.warn(
				`Invalid WELCOME_BONUS_UNTIL "${raw}" (expected ISO-8601 with offset, e.g. 2026-11-20T00:00:00+01:00); using the default`
			);
		}
		return DEFAULT_WELCOME_BONUS_UNTIL;
	}
	return new Date(ms);
}

/** True strictly before the deadline. */
export function isWelcomeBonusOpen(
	now: Date,
	deadline: Date = welcomeBonusDeadline()
): boolean {
	return now.getTime() < deadline.getTime();
}

/**
 * Credits the welcome bonus into the active period, as an approved submission. Returns whether it
 * was granted: false when no period is running (nothing is held for later) or the user already
 * has one (the partial unique index decides, so this is safe under races).
 *
 * The period row is read FOR SHARE, like creditAutoApprovedTask: endPeriod's UPDATE needs the row
 * lock, so a bonus either commits before the winners are computed or the period is no longer
 * active here. Without it, the foreign key alone would not stop a credit landing in an ended
 * period (a non-key UPDATE does not conflict with the FK check). Call inside the signup
 * transaction so the user and the bonus commit or roll back together.
 */
export async function grantWelcomeBonus(
	tx: Executor,
	userId: number,
	now: Date
): Promise<boolean> {
	const [period] = await tx
		.select({ id: periods.id })
		.from(periods)
		.where(eq(periods.status, 'active'))
		.limit(1)
		.for('share');
	if (!period) return false;
	const rows = await tx
		.insert(submissions)
		.values({
			userId,
			taskKey: WELCOME_BONUS_KEY,
			periodId: period.id,
			status: 'approved',
			pointsAwarded: WELCOME_BONUS_POINTS,
			createdAt: now,
			reviewedAt: now
		})
		.onConflictDoNothing()
		.returning({ id: submissions.id });
	return rows.length > 0;
}

/** "20 November" for the deadline, in the app timezone. */
function dayLabel(deadline: Date): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		timeZone: getAppTimezone()
	}).format(deadline);
}

/**
 * What the signup page may say: the offer is live only before the deadline AND while a period is
 * running. Cheap: the query is skipped after the deadline. Exposes no period details.
 */
export async function welcomeBonusOffer(
	db: Pick<Db, 'select'>,
	now: Date,
	deadline: Date = welcomeBonusDeadline()
): Promise<{ open: boolean; untilLabel: string | null }> {
	if (!isWelcomeBonusOpen(now, deadline)) return { open: false, untilLabel: null };
	const [period] = await db
		.select({ id: periods.id })
		.from(periods)
		.where(eq(periods.status, 'active'))
		.limit(1);
	return period
		? { open: true, untilLabel: dayLabel(deadline) }
		: { open: false, untilLabel: null };
}
