import { and, asc, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { EMOJIS, isEmoji, type Emoji } from '$lib/emoji';
import type { FeedComment, FeedPost } from '$lib/feedTypes';
import type { Executor } from './db';
import { comments, posts, reactions, submissions, tasks, users } from './db/schema';
import { sanitizeText } from './sanitize';
import { InactiveUserError, type Submission } from './tasks';

export { EMOJIS, isEmoji, type Emoji };
export { InactiveUserError };

export const POST_MAX = 500;
export const COMMENT_MAX = 300;

export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;

export class NotAuthorError extends Error {
	constructor() {
		super('Only the author can do that');
		this.name = 'NotAuthorError';
	}
}
export class PostNotFoundError extends Error {
	constructor() {
		super('Post not found');
		this.name = 'PostNotFoundError';
	}
}
export class CommentNotFoundError extends Error {
	constructor() {
		super('Comment not found');
		this.name = 'CommentNotFoundError';
	}
}
export class InvalidEmojiError extends Error {
	constructor() {
		super('Unsupported reaction');
		this.name = 'InvalidEmojiError';
	}
}
export class InvalidTextError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidTextError';
	}
}

/** Sanitises and checks 1..max characters (code points) after trimming. */
function cleanText(raw: string, max: number, what: string): string {
	const text = sanitizeText(raw);
	const length = [...text].length;
	if (length < 1) throw new InvalidTextError(`${what} cannot be empty`);
	if (length > max) throw new InvalidTextError(`${what} is too long (${max} characters max)`);
	return text;
}

async function assertActive(db: Executor, userId: number): Promise<void> {
	const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId));
	if (!u?.active) throw new InactiveUserError();
}

async function assertPostExists(db: Executor, postId: number): Promise<void> {
	const [p] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId));
	if (!p) throw new PostNotFoundError();
}

export type CreatePostInput = { body: string; imagePath?: string; milestoneSubmissionId?: number };

/**
 * User posts are text-only (1-500 chars). A post with `milestoneSubmissionId` is a system post:
 * it may carry the proof image, skips the activity check, and is idempotent per submission.
 */
export async function createPost(
	db: Executor,
	authorId: number,
	input: CreatePostInput
): Promise<Post> {
	if (input.milestoneSubmissionId === undefined) {
		if (input.imagePath !== undefined) {
			throw new InvalidTextError('Only milestone posts can carry an image');
		}
		const body = cleanText(input.body, POST_MAX, 'Post');
		await assertActive(db, authorId);
		const [row] = await db.insert(posts).values({ userId: authorId, body }).returning();
		return row;
	}

	const [created] = await db
		.insert(posts)
		.values({
			userId: authorId,
			body: sanitizeText(input.body),
			imagePath: input.imagePath ?? null,
			milestoneSubmissionId: input.milestoneSubmissionId
		})
		.onConflictDoNothing({ target: posts.milestoneSubmissionId })
		.returning();
	if (created) return created;
	// A concurrent/earlier call already posted this milestone; hand back that one.
	const [existing] = await db
		.select()
		.from(posts)
		.where(eq(posts.milestoneSubmissionId, input.milestoneSubmissionId));
	return existing;
}

/** Creates the celebratory post for an approved milestone submission, inside the approve tx. */
export async function createMilestonePost(db: Executor, submission: Submission): Promise<void> {
	const [row] = await db
		.select({ username: users.displayUsername, label: tasks.label })
		.from(users)
		.innerJoin(tasks, eq(tasks.key, submission.taskKey))
		.where(eq(users.id, submission.userId));
	if (!row) throw new Error(`Cannot create milestone post for submission ${submission.id}`);
	await createPost(db, submission.userId, {
		body: `${row.username} just did: ${row.label}! 🎉`,
		imagePath: submission.imagePath ?? undefined,
		milestoneSubmissionId: submission.id
	});
}

/** Adapter with the argument order `approve({ onMilestone })` uses. */
export const onMilestonePost = (submission: Submission, tx: Executor) =>
	createMilestonePost(tx, submission);

// ---------------------------------------------------------------- listing

export type PostView = {
	id: number;
	createdAt: Date;
	body: string;
	imagePath: string | null;
	milestone: { taskLabel: string } | null;
	author: {
		id: number;
		username: string;
		avatar: string | null;
		department: string | null;
		classification: string | null;
		deactivated: boolean;
	};
	reactions: Record<Emoji, number>;
	mine: Emoji[];
	commentCount: number;
};

/**
 * Keyset cursor: (`before`, `beforeId`) is the last post of the previous page. Ordering is
 * (created_at truncated to milliseconds, id) descending; truncating makes the cursor (a JS
 * Date, millisecond precision) compare exactly against what it was derived from.
 */
export type PostCursor = { before: Date; beforeId: number };

const createdMs = sql`date_trunc('milliseconds', ${posts.createdAt})`;

const emptyCounts = (): Record<Emoji, number> =>
	Object.fromEntries(EMOJIS.map((e) => [e, 0])) as Record<Emoji, number>;

export async function listPosts(
	db: Executor,
	opts: { before?: Date; beforeId?: number; limit: number; viewerId?: number }
): Promise<{ posts: PostView[]; next: PostCursor | null }> {
	const { before, beforeId, limit, viewerId } = opts;
	const beforeIso = before?.toISOString();
	const cursorWhere = before
		? beforeId === undefined
			? sql`${createdMs} < ${beforeIso}::timestamptz`
			: or(
					sql`${createdMs} < ${beforeIso}::timestamptz`,
					and(sql`${createdMs} = ${beforeIso}::timestamptz`, lt(posts.id, beforeId))
				)
		: undefined;

	// Query 1: the page (one extra row tells us whether there is a next page).
	const rows = await db
		.select({
			id: posts.id,
			createdAt: posts.createdAt,
			body: posts.body,
			imagePath: posts.imagePath,
			milestoneSubmissionId: posts.milestoneSubmissionId,
			taskLabel: tasks.label,
			authorId: users.id,
			username: users.displayUsername,
			avatar: users.avatarPath,
			department: users.department,
			classification: users.classification,
			active: users.active
		})
		.from(posts)
		.innerJoin(users, eq(users.id, posts.userId))
		.leftJoin(submissions, eq(submissions.id, posts.milestoneSubmissionId))
		.leftJoin(tasks, eq(tasks.key, submissions.taskKey))
		.where(cursorWhere)
		.orderBy(desc(createdMs), desc(posts.id))
		.limit(limit + 1);

	const pageRows = rows.slice(0, limit);
	if (pageRows.length === 0) return { posts: [], next: null };
	const ids = pageRows.map((r) => r.id);

	// Query 2: reaction counts per (post, emoji), plus how many of them are the viewer's.
	const reactionRows = await db
		.select({
			postId: reactions.postId,
			emoji: reactions.emoji,
			n: sql<number>`count(*)::int`,
			mine: sql<number>`(count(*) filter (where ${reactions.userId} = ${viewerId ?? -1}))::int`
		})
		.from(reactions)
		.where(inArray(reactions.postId, ids))
		.groupBy(reactions.postId, reactions.emoji);

	// Query 3: comment counts.
	const commentRows = await db
		.select({ postId: comments.postId, n: sql<number>`count(*)::int` })
		.from(comments)
		.where(inArray(comments.postId, ids))
		.groupBy(comments.postId);

	const counts = new Map<number, Record<Emoji, number>>();
	const mine = new Map<number, Emoji[]>();
	for (const r of reactionRows) {
		if (!isEmoji(r.emoji)) continue;
		const c = counts.get(r.postId) ?? emptyCounts();
		c[r.emoji] = r.n;
		counts.set(r.postId, c);
		if (r.mine > 0) mine.set(r.postId, [...(mine.get(r.postId) ?? []), r.emoji]);
	}
	const commentCounts = new Map(commentRows.map((r) => [r.postId, r.n]));

	const last = pageRows[pageRows.length - 1];
	return {
		posts: pageRows.map((r) => ({
			id: r.id,
			createdAt: r.createdAt,
			body: r.body,
			imagePath: r.imagePath,
			milestone: r.milestoneSubmissionId !== null ? { taskLabel: r.taskLabel ?? 'a milestone' } : null,
			author: {
				id: r.authorId,
				username: r.username,
				avatar: r.avatar,
				department: r.department,
				classification: r.classification,
				deactivated: !r.active
			},
			reactions: counts.get(r.id) ?? emptyCounts(),
			mine: mine.get(r.id) ?? [],
			commentCount: commentCounts.get(r.id) ?? 0
		})),
		next: rows.length > limit ? { before: last.createdAt, beforeId: last.id } : null
	};
}

// ---------------------------------------------------------------- reactions

async function reactionState(db: Executor, postId: number, userId: number) {
	const rows = await db
		.select({ emoji: reactions.emoji, n: count(), mine: sql<number>`(count(*) filter (where ${reactions.userId} = ${userId}))::int` })
		.from(reactions)
		.where(eq(reactions.postId, postId))
		.groupBy(reactions.emoji);
	const counts = emptyCounts();
	const mine: Emoji[] = [];
	for (const r of rows) {
		if (!isEmoji(r.emoji)) continue;
		counts[r.emoji] = r.n;
		if (r.mine > 0) mine.push(r.emoji);
	}
	return { counts, mine };
}

/** Adds the reaction if the user has not given it, removes it otherwise. */
export async function toggleReaction(
	db: Executor,
	userId: number,
	postId: number,
	emoji: Emoji
): Promise<{ counts: Record<Emoji, number>; mine: Emoji[] }> {
	if (!isEmoji(emoji)) throw new InvalidEmojiError();
	await assertActive(db, userId);
	await assertPostExists(db, postId);
	const removed = await db
		.delete(reactions)
		.where(and(eq(reactions.postId, postId), eq(reactions.userId, userId), eq(reactions.emoji, emoji)))
		.returning({ postId: reactions.postId });
	if (removed.length === 0) {
		await db.insert(reactions).values({ postId, userId, emoji }).onConflictDoNothing();
	}
	return reactionState(db, postId, userId);
}

// ---------------------------------------------------------------- comments

export async function addComment(
	db: Executor,
	userId: number,
	postId: number,
	body: string
): Promise<Comment> {
	const text = cleanText(body, COMMENT_MAX, 'Comment');
	await assertActive(db, userId);
	await assertPostExists(db, postId);
	const [row] = await db.insert(comments).values({ postId, userId, body: text }).returning();
	return row;
}

export type CommentView = {
	id: number;
	postId: number;
	createdAt: Date;
	body: string;
	author: PostView['author'];
};

/** Oldest first. */
export async function listComments(db: Executor, postId: number): Promise<CommentView[]> {
	const rows = await db
		.select({
			id: comments.id,
			postId: comments.postId,
			createdAt: comments.createdAt,
			body: comments.body,
			authorId: users.id,
			username: users.displayUsername,
			avatar: users.avatarPath,
			department: users.department,
			classification: users.classification,
			active: users.active
		})
		.from(comments)
		.innerJoin(users, eq(users.id, comments.userId))
		.where(eq(comments.postId, postId))
		.orderBy(asc(comments.createdAt), asc(comments.id));
	return rows.map((r) => ({
		id: r.id,
		postId: r.postId,
		createdAt: r.createdAt,
		body: r.body,
		author: {
			id: r.authorId,
			username: r.username,
			avatar: r.avatar,
			department: r.department,
			classification: r.classification,
			deactivated: !r.active
		}
	}));
}

// ---------------------------------------------------------------- deletion

/** Comments and reactions go with the post (ON DELETE CASCADE). */
export async function deleteOwnPost(db: Executor, userId: number, postId: number): Promise<void> {
	const [p] = await db.select({ userId: posts.userId }).from(posts).where(eq(posts.id, postId));
	if (!p) throw new PostNotFoundError();
	if (p.userId !== userId) throw new NotAuthorError();
	await db.delete(posts).where(and(eq(posts.id, postId), eq(posts.userId, userId)));
}

export async function deleteOwnComment(
	db: Executor,
	userId: number,
	commentId: number
): Promise<void> {
	const [c] = await db
		.select({ userId: comments.userId })
		.from(comments)
		.where(eq(comments.id, commentId));
	if (!c) throw new CommentNotFoundError();
	if (c.userId !== userId) throw new NotAuthorError();
	await db.delete(comments).where(and(eq(comments.id, commentId), eq(comments.userId, userId)));
}

// ---------------------------------------------------------------- serialisation

export function toFeedPost(p: PostView): FeedPost {
	return { ...p, createdAt: p.createdAt.toISOString() };
}

export function toFeedComment(c: CommentView): FeedComment {
	return { ...c, createdAt: c.createdAt.toISOString() };
}
