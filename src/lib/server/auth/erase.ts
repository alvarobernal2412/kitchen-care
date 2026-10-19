import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../db';
import { comments, events, posts, reactions, resetTokens, sessions, submissions, users } from '../db/schema';
import { deleteUpload } from '../images';
import { hashPassword, verifyPassword } from './hash';
import { AuthError } from './users';

export class LastAdminError extends Error {
	constructor() {
		super('You are the only admin. Make someone else an admin before deleting your account.');
	}
}

type Opts = { dir?: string };

/**
 * GDPR erasure. After checking the password it, in one transaction, deletes the user's posts,
 * comments, reactions, sessions, reset tokens and analytics events, strips the profile to an
 * unusable "Deleted user" row, and clears proof-image references. Submission rows stay (points,
 * period history and the leaderboard are unaffected) but no longer identify anyone. Image files
 * are removed once the transaction has committed; a leftover file is harmless.
 */
export async function eraseAccount(
	db: Db,
	userId: number,
	password: string,
	opts: Opts = {}
): Promise<void> {
	const [row] = await db.select().from(users).where(eq(users.id, userId));
	if (!row || !row.active || !(await verifyPassword(row.passwordHash, password))) {
		throw new AuthError('wrong_password', 'Password is incorrect.');
	}
	const lockedHash = await hashPassword(randomBytes(32).toString('hex'));
	const now = new Date();

	const files = await db.transaction(async (tx) => {
		const admins = await tx
			.select({ id: users.id })
			.from(users)
			.where(or(and(eq(users.role, 'admin'), eq(users.active, true)), eq(users.id, userId)))
			.orderBy(users.id)
			.for('update');
		if (row.role === 'admin' && !admins.some((a) => a.id !== userId)) throw new LastAdminError();

		const mine = await tx
			.select({ imagePath: posts.imagePath })
			.from(posts)
			.where(eq(posts.userId, userId));
		const proofs = await tx
			.select({ id: submissions.id, imagePath: submissions.imagePath })
			.from(submissions)
			.where(and(eq(submissions.userId, userId), isNotNull(submissions.imagePath)));

		// Comments and reactions on the user's posts cascade with the posts; the rest are by id.
		await tx.delete(comments).where(eq(comments.userId, userId));
		await tx.delete(reactions).where(eq(reactions.userId, userId));
		await tx.delete(posts).where(eq(posts.userId, userId));
		await tx.delete(events).where(eq(events.userId, userId));
		await tx.delete(sessions).where(eq(sessions.userId, userId));
		await tx.delete(resetTokens).where(eq(resetTokens.userId, userId));
		if (proofs.length) {
			await tx
				.update(submissions)
				.set({ imagePath: null, imageRemovedAt: now })
				.where(
					inArray(
						submissions.id,
						proofs.map((p) => p.id)
					)
				);
		}
		await tx
			.update(users)
			.set({
				displayUsername: 'Deleted user',
				usernameNormalized: `deleted-${userId}`,
				passwordHash: lockedHash,
				classification: null,
				department: null,
				avatarPath: null,
				active: false
			})
			.where(eq(users.id, userId));

		return [
			...new Set(
				[row.avatarPath, ...mine.map((p) => p.imagePath), ...proofs.map((p) => p.imagePath)].filter(
					(f): f is string => !!f
				)
			)
		];
	});

	for (const file of files) {
		await deleteUpload(file, opts).catch((err) => console.warn('Could not delete erased file', err));
	}
}
