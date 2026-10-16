import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { comments, posts, reactions, users } from '../../src/lib/server/db/schema';
import {
	CommentNotFoundError,
	PostNotFoundError,
	addComment,
	createPost,
	toggleReaction
} from '../../src/lib/server/feed';
import { EMOJIS } from '../../src/lib/emoji';
import { NotAdminError } from '../../src/lib/server/review';
import { adminDeleteComment, adminDeletePost } from '../../src/lib/server/moderation';

let t: TestDb;
let admin: number;
let author: number;
let seq = 0;

async function mk(role: 'user' | 'admin' = 'user') {
	const n = `m${++seq}`;
	const [r] = await t.db
		.insert(users)
		.values({ usernameNormalized: n, displayUsername: n, passwordHash: 'x', role })
		.returning();
	return r.id;
}

beforeAll(async () => {
	t = await getTestDb();
	admin = await mk('admin');
	author = await mk();
});
afterAll(async () => {
	await t.close();
});

describe('moderation', () => {
	it("lets an admin delete another user's post with its comments and reactions", async () => {
		const p = await createPost(t.db, author, { body: 'hello' });
		await addComment(t.db, author, p.id, 'c');
		await toggleReaction(t.db, author, p.id, EMOJIS[0]);
		await adminDeletePost(t.db, admin, p.id);
		expect(await t.db.select().from(posts).where(eq(posts.id, p.id))).toHaveLength(0);
		expect(await t.db.select().from(comments).where(eq(comments.postId, p.id))).toHaveLength(0);
		expect(await t.db.select().from(reactions).where(eq(reactions.postId, p.id))).toHaveLength(0);
	});

	it("lets an admin delete another user's comment only", async () => {
		const p = await createPost(t.db, author, { body: 'hello' });
		const c = await addComment(t.db, author, p.id, 'rude');
		await adminDeleteComment(t.db, admin, c.id);
		expect(await t.db.select().from(comments).where(eq(comments.id, c.id))).toHaveLength(0);
		expect(await t.db.select().from(posts).where(eq(posts.id, p.id))).toHaveLength(1);
	});

	it('refuses non-admins and inactive admins', async () => {
		const p = await createPost(t.db, author, { body: 'mine' });
		const c = await addComment(t.db, author, p.id, 'mine');
		const other = await mk();
		const dead = await mk('admin');
		await t.db.update(users).set({ active: false }).where(eq(users.id, dead));
		for (const actor of [other, author, dead]) {
			await expect(adminDeletePost(t.db, actor, p.id)).rejects.toBeInstanceOf(NotAdminError);
			await expect(adminDeleteComment(t.db, actor, c.id)).rejects.toBeInstanceOf(NotAdminError);
		}
		expect(await t.db.select().from(posts).where(eq(posts.id, p.id))).toHaveLength(1);
		expect(await t.db.select().from(comments).where(eq(comments.id, c.id))).toHaveLength(1);
	});

	it('reports missing targets', async () => {
		await expect(adminDeletePost(t.db, admin, 999999)).rejects.toBeInstanceOf(PostNotFoundError);
		await expect(adminDeleteComment(t.db, admin, 999999)).rejects.toBeInstanceOf(
			CommentNotFoundError
		);
	});
});
