import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db';
import { resetTokens, sessions, users } from '../db/schema';
import { hashPassword, verifyPassword } from './hash';
import { validatePassword } from './password';
import { hashSessionId } from './session';
import { InactiveUserError } from '../tasks';
import { AuthError, UsernameTakenError, isUniqueViolation, parseUsername } from './users';

/**
 * Changes a user's password after verifying the current one, then revokes every other session
 * of that user. `keepSessionId` is the raw session id (cookie value) of the calling session.
 */
export async function changePassword(
	db: Db,
	userId: number,
	currentPassword: string,
	newPassword: string,
	keepSessionId: string
): Promise<void> {
	const [row] = await db.select().from(users).where(eq(users.id, userId));
	if (!row || !(await verifyPassword(row.passwordHash, currentPassword))) {
		throw new AuthError('wrong_password', 'Current password is incorrect.');
	}
	if (!validatePassword(newPassword).ok) {
		throw new AuthError('weak_password', 'Password does not meet the policy.');
	}
	const passwordHash = await hashPassword(newPassword);
	await db.transaction(async (tx) => {
		await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
		// An unused admin-issued reset link must not outlive the password it was meant to replace.
		await tx
			.delete(resetTokens)
			.where(and(eq(resetTokens.userId, userId), isNull(resetTokens.usedAt)));
		await tx
			.delete(sessions)
			.where(and(eq(sessions.userId, userId), ne(sessions.id, hashSessionId(keepSessionId))));
	});
}

/**
 * Renames a user after verifying their current password. Same rules as sign-up; a case-only change
 * of your own name is fine, a name used by anyone else is not. Sessions and reset tokens are left
 * alone. The unique index on username_normalized settles races, so there is no check-then-write.
 */
export async function changeUsername(
	db: Db,
	userId: number,
	currentPassword: string,
	newUsername: string,
	opts: { now?: Date } = {}
): Promise<void> {
	void opts;
	const [row] = await db.select().from(users).where(eq(users.id, userId));
	if (!row || !(await verifyPassword(row.passwordHash, currentPassword))) {
		throw new AuthError('wrong_password', 'Current password is incorrect.');
	}
	if (!row.active) throw new InactiveUserError();
	const { display, normalized } = parseUsername(newUsername);
	if (row.displayUsername === display) return;
	try {
		await db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({ displayUsername: display, usernameNormalized: normalized })
				.where(and(eq(users.id, userId), eq(users.active, true)));
		});
	} catch (err) {
		if (isUniqueViolation(err)) throw new UsernameTakenError();
		throw err;
	}
}
