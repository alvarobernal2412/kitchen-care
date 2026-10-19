import { desc, eq } from 'drizzle-orm';
import type { Db } from './db';
import { comments, posts, reactions, submissions, users } from './db/schema';

/**
 * Everything the app stores about one user (GDPR Art. 15/20), as plain JSON-friendly data.
 * Credentials and session ids are never included.
 */
export async function exportUserData(db: Db, userId: number) {
	const [u] = await db.select().from(users).where(eq(users.id, userId));
	if (!u) throw new Error('User not found');
	const [subs, myPosts, myComments, myReactions] = await Promise.all([
		db
			.select({
				taskKey: submissions.taskKey,
				status: submissions.status,
				pointsAwarded: submissions.pointsAwarded,
				hasImage: submissions.imagePath,
				rejectReason: submissions.rejectReason,
				createdAt: submissions.createdAt,
				reviewedAt: submissions.reviewedAt
			})
			.from(submissions)
			.where(eq(submissions.userId, userId))
			.orderBy(desc(submissions.createdAt)),
		db
			.select({ id: posts.id, title: posts.title, body: posts.body, createdAt: posts.createdAt })
			.from(posts)
			.where(eq(posts.userId, userId))
			.orderBy(desc(posts.createdAt)),
		db
			.select({ postId: comments.postId, body: comments.body, createdAt: comments.createdAt })
			.from(comments)
			.where(eq(comments.userId, userId))
			.orderBy(desc(comments.createdAt)),
		db
			.select({ postId: reactions.postId, emoji: reactions.emoji })
			.from(reactions)
			.where(eq(reactions.userId, userId))
	]);
	return {
		exportedAt: new Date().toISOString(),
		profile: {
			username: u.displayUsername,
			role: u.role,
			classification: u.classification,
			department: u.department,
			hasAvatar: u.avatarPath !== null,
			createdAt: u.createdAt
		},
		submissions: subs.map(({ hasImage, ...s }) => ({ ...s, hasImage: hasImage !== null })),
		posts: myPosts,
		comments: myComments,
		reactions: myReactions
	};
}
