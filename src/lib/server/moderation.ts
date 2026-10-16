import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { comments, posts } from './db/schema';
import { CommentNotFoundError, PostNotFoundError } from './feed';
import { assertAdmin } from './review';

/** Admin-only. Comments and reactions go with the post (ON DELETE CASCADE). */
export async function adminDeletePost(db: Db, adminId: number, postId: number): Promise<void> {
	await db.transaction(async (tx) => {
		await assertAdmin(tx, adminId);
		const gone = await tx.delete(posts).where(eq(posts.id, postId)).returning({ id: posts.id });
		if (gone.length === 0) throw new PostNotFoundError();
	});
}

/** Admin-only. */
export async function adminDeleteComment(
	db: Db,
	adminId: number,
	commentId: number
): Promise<void> {
	await db.transaction(async (tx) => {
		await assertAdmin(tx, adminId);
		const gone = await tx
			.delete(comments)
			.where(eq(comments.id, commentId))
			.returning({ id: comments.id });
		if (gone.length === 0) throw new CommentNotFoundError();
	});
}
