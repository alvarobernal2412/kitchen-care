import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db';
import { resetTokens, sessions, users } from '../db/schema';
import { hashPassword, verifyPassword } from './hash';
import { validatePassword } from './password';
import { hashSessionId } from './session';
import { AuthError } from './users';

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
