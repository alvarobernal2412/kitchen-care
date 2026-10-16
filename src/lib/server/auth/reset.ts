import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { resetTokens, users } from '../db/schema';
import { hashPassword } from './hash';
import { validatePassword } from './password';
import { revokeUserSessions } from './session';
import { AuthError } from './users';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export type ResetErrorCode = 'invalid_token' | 'forbidden' | 'user_not_found';

/** Unknown, expired, used and deactivated-user tokens all share `invalid_token` on purpose. */
export class ResetError extends Error {
	constructor(
		public readonly code: ResetErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ResetError';
	}
}

const INVALID = () => new ResetError('invalid_token', 'This reset link is invalid or expired.');

/** Only this digest is stored; a DB leak therefore does not yield usable reset links. */
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Admin-only. Returns the raw token (shown once to the admin); only its hash is stored. */
export async function createResetToken(
	db: Db,
	adminId: number,
	userId: number,
	now: Date = new Date()
): Promise<string> {
	const token = randomBytes(32).toString('hex');
	await db.transaction(async (tx) => {
		const [actor] = await tx.select().from(users).where(eq(users.id, adminId));
		if (!actor || actor.role !== 'admin' || !actor.active) {
			throw new ResetError('forbidden', 'Only an active admin can create reset links.');
		}
		// Row lock serialises concurrent creations for one user so only the latest link survives.
		const [target] = await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, userId))
			.for('update');
		if (!target) throw new ResetError('user_not_found', 'User not found.');

		// Only the latest link may work.
		await tx
			.delete(resetTokens)
			.where(and(eq(resetTokens.userId, userId), isNull(resetTokens.usedAt)));
		await tx.insert(resetTokens).values({
			tokenHash: hashToken(token),
			userId,
			expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS)
		});
	});
	return token;
}

export async function consumeResetToken(
	db: Db,
	token: string,
	newPassword: string,
	now: Date = new Date()
): Promise<void> {
	await db.transaction(async (tx) => {
		// FOR UPDATE serialises concurrent consumers of the same token.
		const [row] = await tx
			.select({
				userId: resetTokens.userId,
				expiresAt: resetTokens.expiresAt,
				usedAt: resetTokens.usedAt,
				active: users.active
			})
			.from(resetTokens)
			.innerJoin(users, eq(users.id, resetTokens.userId))
			.where(eq(resetTokens.tokenHash, hashToken(token)))
			.for('update', { of: resetTokens });
		if (!row || row.usedAt || now.getTime() >= row.expiresAt.getTime() || !row.active) {
			throw INVALID();
		}
		// Validated before the token is marked used: a weak password must not burn the link.
		if (!validatePassword(newPassword).ok) {
			throw new AuthError('weak_password', 'Password does not meet the policy.');
		}

		const passwordHash = await hashPassword(newPassword);
		await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
		await tx
			.update(resetTokens)
			.set({ usedAt: now })
			.where(eq(resetTokens.tokenHash, hashToken(token)));
		await revokeUserSessions(tx, row.userId);
	});
}

/** Link the admin hands to the user (Task 10 UI). */
export function buildResetUrl(origin: string, token: string): string {
	return `${origin.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}
