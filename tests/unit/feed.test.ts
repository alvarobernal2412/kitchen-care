import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import {
	comments,
	periods,
	posts,
	reactions,
	submissions,
	users
} from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import { submitPhotoTask, InactiveUserError } from '../../src/lib/server/tasks';
import { approve } from '../../src/lib/server/review';
import { sanitizeText } from '../../src/lib/server/sanitize';
import {
	EMOJIS,
	InvalidEmojiError,
	InvalidTextError,
	NotAuthorError,
	addComment,
	createMilestonePost,
	milestoneTitle,
	onMilestonePost,
	createPost,
	deleteOwnComment,
	deleteOwnPost,
	isEmoji,
	listComments,
	listPosts,
	toggleReaction,
	type Emoji
} from '../../src/lib/server/feed';

let t: TestDb;
let alice: number;
let bob: number;
let admin: number;
let dir: string;

async function mkUser(name: string, role: 'user' | 'admin' = 'user') {
	const [row] = await t.db
		.insert(users)
		.values({
			usernameNormalized: name,
			displayUsername: name,
			passwordHash: 'x',
			role,
			department: 'Interactions Research Group',
			classification: 'Employee'
		})
		.returning();
	return row.id;
}

const img = () =>
	sharp({ create: { width: 64, height: 64, channels: 3, background: '#a33' } })
		.jpeg()
		.toBuffer();

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	alice = await mkUser('alice');
	bob = await mkUser('bob');
	admin = await mkUser('boss', 'admin');
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-feed-'));
	await t.db.delete(reactions);
	await t.db.delete(comments);
	await t.db.delete(posts);
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await t.db.update(users).set({ active: true });
	await createPeriod(t.db, 'Test');
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('sanitizeText', () => {
	it('keeps markup as plain text (escaping is the renderer job)', () => {
		expect(sanitizeText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
	});
	it('strips control characters but keeps newline and tab', () => {
		expect(sanitizeText('a\u0000b\u0007c\u001Fd\u007Fe\tf\ng')).toBe('abcde\tf\ng');
	});
	it('strips zero-width and bidi override characters', () => {
		expect(sanitizeText('a‮b​c‎d⁦e﻿f⁠g')).toBe('abcdefg');
	});
	it('keeps ZWJ emoji sequences intact', () => {
		expect(sanitizeText('👩‍💻')).toBe('👩‍💻');
	});
	it('normalises CRLF/CR to LF, collapses 3+ newlines to 2 and trims', () => {
		expect(sanitizeText('  a\r\nb\rc\n\n\n\n\nd \n ')).toBe('a\nb\nc\n\nd');
	});
	it('returns empty for whitespace/invisible-only input', () => {
		expect(sanitizeText(' ​‮ \n ')).toBe('');
	});
});

describe('emoji', () => {
	it('exposes exactly the five reactions with a type guard', () => {
		expect([...EMOJIS]).toEqual(['👏', '❤️', '☕', '🎉', '🙌']);
		expect(isEmoji('☕')).toBe(true);
		expect(isEmoji('👍')).toBe(false);
		expect(isEmoji(5)).toBe(false);
	});
});

describe('createPost', () => {
	it('creates a sanitised text post', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: '  hello\r\nworld ​ ' });
		expect(p).toMatchObject({ userId: alice, body: 'hello\nworld', imagePath: null });
	});

	it('enforces 1-500 characters after trimming', async () => {
		await expect(createPost(t.db, alice, { title: 'Title', body: '' })).rejects.toBeInstanceOf(InvalidTextError);
		await expect(createPost(t.db, alice, { title: 'Title', body: '   ​ ' })).rejects.toBeInstanceOf(
			InvalidTextError
		);
		await expect(createPost(t.db, alice, { title: 'Title', body: 'a' })).resolves.toBeTruthy();
		await expect(createPost(t.db, alice, { title: 'Title', body: 'a'.repeat(500) })).resolves.toBeTruthy();
		await expect(createPost(t.db, alice, { title: 'Title', body: 'a'.repeat(501) })).rejects.toBeInstanceOf(
			InvalidTextError
		);
	});

	describe('title', () => {
		const make = (title: string) => createPost(t.db, alice, { title, body: 'body' });

		it('is required: empty and whitespace-only/invisible titles are rejected', async () => {
			await expect(make('')).rejects.toBeInstanceOf(InvalidTextError);
			await expect(make('   \n\t ​ ')).rejects.toBeInstanceOf(InvalidTextError);
			await expect(make('')).rejects.toThrow(/title cannot be empty/i);
		});

		it('accepts 1 and 80 characters, rejects 81', async () => {
			await expect(make('a')).resolves.toMatchObject({ title: 'a' });
			await expect(make('b'.repeat(80))).resolves.toBeTruthy();
			await expect(make('c'.repeat(81))).rejects.toThrow(
				/title is too long \(80 characters max\)/i
			);
		});

		it('counts code points, not UTF-16 units', async () => {
			await expect(make('😀'.repeat(80))).resolves.toBeTruthy();
			await expect(make('😀'.repeat(81))).rejects.toBeInstanceOf(InvalidTextError);
		});

		it('trims, collapses newlines to spaces and strips control characters', async () => {
			expect((await make('  Hello\r\nthere\n\n\nfriend  ')).title).toBe('Hello there friend');
			expect((await make('a\u0007b\u0000c')).title).toBe('abc');
		});

		it('keeps the body required', async () => {
			await expect(createPost(t.db, alice, { title: 'ok', body: '' })).rejects.toThrow(
				/post cannot be empty/i
			);
			expect(await t.db.select().from(posts)).toHaveLength(0);
		});

		it('is stored as inert text', async () => {
			expect((await make('<b>hi</b>')).title).toBe('<b>hi</b>');
		});
	});

	it('refuses user images (only milestone posts carry one)', async () => {
		await expect(
			createPost(t.db, alice, { title: 'Title', body: 'x', imagePath: 'a.webp' })
		).rejects.toBeInstanceOf(InvalidTextError);
	});

	it('stores <script> as inert text', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: '<script>alert(1)</script>' });
		expect(p.body).toBe('<script>alert(1)</script>');
	});

	it('rejects deactivated users', async () => {
		await t.db.update(users).set({ active: false }).where(eq(users.id, alice));
		await expect(createPost(t.db, alice, { title: 'Title', body: 'hi' })).rejects.toBeInstanceOf(
			InactiveUserError
		);
	});
});

describe('reactions', () => {
	it('toggling the same emoji twice returns the count to 0', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		const on = await toggleReaction(t.db, bob, p.id, '👏');
		expect(on.counts['👏']).toBe(1);
		expect(on.mine).toEqual(['👏']);
		const off = await toggleReaction(t.db, bob, p.id, '👏');
		expect(off.counts['👏']).toBe(0);
		expect(off.mine).toEqual([]);
	});

	it('counts each user independently and covers all five emojis', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await toggleReaction(t.db, alice, p.id, '☕');
		const r = await toggleReaction(t.db, bob, p.id, '☕');
		await toggleReaction(t.db, bob, p.id, '🎉');
		expect(r.counts).toEqual({ '👏': 0, '❤️': 0, '☕': 2, '🎉': 0, '🙌': 0 });
		const after = await toggleReaction(t.db, alice, p.id, '☕'); // alice off, bob stays
		expect(after.counts['☕']).toBe(1);
		expect(after.mine).toEqual([]);
	});

	it('rejects emojis outside the five', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await expect(toggleReaction(t.db, bob, p.id, '👍' as Emoji)).rejects.toBeInstanceOf(
			InvalidEmojiError
		);
		expect(await t.db.select().from(reactions)).toHaveLength(0);
	});

	it('rejects deactivated users and unknown posts', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await t.db.update(users).set({ active: false }).where(eq(users.id, bob));
		await expect(toggleReaction(t.db, bob, p.id, '👏')).rejects.toBeInstanceOf(
			InactiveUserError
		);
		await expect(toggleReaction(t.db, alice, 999999, '👏')).rejects.toThrow(/not found/i);
	});
});

describe('comments', () => {
	it('enforces 1-300 characters', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await expect(addComment(t.db, bob, p.id, '')).rejects.toBeInstanceOf(InvalidTextError);
		await expect(addComment(t.db, bob, p.id, 'a')).resolves.toBeTruthy();
		await expect(addComment(t.db, bob, p.id, 'a'.repeat(300))).resolves.toBeTruthy();
		await expect(addComment(t.db, bob, p.id, 'a'.repeat(301))).rejects.toBeInstanceOf(
			InvalidTextError
		);
	});

	it('neutralises <script> as plain text and strips bidi overrides', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		const c = await addComment(t.db, bob, p.id, '<script>alert(1)</script>‮');
		expect(c.body).toBe('<script>alert(1)</script>');
	});

	it('lists oldest first with author info', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await addComment(t.db, bob, p.id, 'first');
		await addComment(t.db, alice, p.id, 'second');
		const list = await listComments(t.db, p.id);
		expect(list.map((c) => c.body)).toEqual(['first', 'second']);
		expect(list[0].author).toMatchObject({ id: bob, username: 'bob', deactivated: false });
	});

	it('rejects deactivated users and missing posts', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await t.db.update(users).set({ active: false }).where(eq(users.id, bob));
		await expect(addComment(t.db, bob, p.id, 'x')).rejects.toBeInstanceOf(InactiveUserError);
		await expect(addComment(t.db, alice, 999999, 'x')).rejects.toThrow(/not found/i);
	});

	it('only the author deletes a comment', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		const c = await addComment(t.db, bob, p.id, 'mine');
		await expect(deleteOwnComment(t.db, alice, c.id)).rejects.toBeInstanceOf(NotAuthorError);
		await expect(deleteOwnComment(t.db, admin, c.id)).rejects.toBeInstanceOf(NotAuthorError);
		await deleteOwnComment(t.db, bob, c.id);
		expect(await listComments(t.db, p.id)).toHaveLength(0);
		await expect(deleteOwnComment(t.db, bob, c.id)).rejects.toThrow(/not found/i);
	});
});

describe('deleteOwnPost', () => {
	it("throws NotAuthorError for someone else's post and leaves it", async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await expect(deleteOwnPost(t.db, bob, p.id)).rejects.toBeInstanceOf(NotAuthorError);
		expect(await t.db.select().from(posts)).toHaveLength(1);
	});

	it('removes own post with its comments and reactions', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		const other = await createPost(t.db, alice, { title: 'Title', body: 'keep' });
		await addComment(t.db, bob, p.id, 'c');
		await toggleReaction(t.db, bob, p.id, '👏');
		await toggleReaction(t.db, bob, other.id, '👏');
		await deleteOwnPost(t.db, alice, p.id);
		expect(await t.db.select().from(posts)).toHaveLength(1);
		expect(await t.db.select().from(comments)).toHaveLength(0);
		expect(await t.db.select().from(reactions)).toHaveLength(1);
	});

	it('throws for a missing post', async () => {
		await expect(deleteOwnPost(t.db, alice, 999999)).rejects.toThrow(/not found/i);
	});
});

describe('listPosts', () => {
	it('returns the title of each post and the live author name', async () => {
		await createPost(t.db, alice, { title: 'Oat milk is back', body: 'second shelf' });
		await t.db.update(users).set({ displayUsername: 'Alice2' }).where(eq(users.id, alice));
		const [post] = (await listPosts(t.db, { limit: 5 })).posts;
		expect(post).toMatchObject({ title: 'Oat milk is back', body: 'second shelf' });
		expect(post.author.username).toBe('Alice2');
		await t.db.update(users).set({ displayUsername: 'alice' }).where(eq(users.id, alice));
	});

	async function seedAt(n: number, at: (i: number) => Date) {
		const ids: number[] = [];
		for (let i = 0; i < n; i++) {
			const [row] = await t.db
				.insert(posts)
				.values({ userId: alice, title: `T${i}`, body: `p${i}`, createdAt: at(i) })
				.returning();
			ids.push(row.id);
		}
		return ids;
	}

	it('returns newest first with a limit and a next cursor', async () => {
		await seedAt(5, (i) => new Date(Date.UTC(2026, 9, 16, 10, i)));
		const page = await listPosts(t.db, { limit: 2 });
		expect(page.posts.map((p) => p.body)).toEqual(['p4', 'p3']);
		expect(page.next).not.toBeNull();
	});

	it('pages without duplicates or gaps, even for posts sharing a timestamp', async () => {
		const same = new Date('2026-10-16T10:00:00.000Z');
		await seedAt(7, (i) => (i < 5 ? same : new Date(same.getTime() + 1000 * i)));
		const seen: string[] = [];
		let cursor: { before: Date; beforeId: number } | undefined;
		let pages = 0;
		do {
			const page = await listPosts(t.db, { limit: 2, ...cursor });
			seen.push(...page.posts.map((p) => p.body));
			cursor = page.next ?? undefined;
			pages++;
		} while (cursor && pages < 10);
		expect(pages).toBe(4);
		expect(seen).toEqual(['p6', 'p5', 'p4', 'p3', 'p2', 'p1', 'p0']);
	});

	it('has no next cursor on the last page', async () => {
		await seedAt(2, (i) => new Date(Date.UTC(2026, 9, 16, 10, i)));
		const page = await listPosts(t.db, { limit: 2 });
		expect(page.posts).toHaveLength(2);
		expect(page.next).toBeNull();
	});

	it('includes author, counts, own reactions and comment counts', async () => {
		const p = await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await toggleReaction(t.db, alice, p.id, '👏');
		await toggleReaction(t.db, bob, p.id, '👏');
		await toggleReaction(t.db, bob, p.id, '🎉');
		await addComment(t.db, bob, p.id, 'c1');
		await addComment(t.db, alice, p.id, 'c2');

		const asBob = (await listPosts(t.db, { limit: 10, viewerId: bob })).posts[0];
		expect(asBob.reactions).toEqual({ '👏': 2, '❤️': 0, '☕': 0, '🎉': 1, '🙌': 0 });
		expect([...asBob.mine].sort()).toEqual(['🎉', '👏'].sort());
		expect(asBob.commentCount).toBe(2);
		expect(asBob.author).toEqual({
			id: alice,
			username: 'alice',
			avatar: null,
			department: 'Interactions Research Group',
			classification: 'Employee',
			deactivated: false
		});
		expect(asBob.milestone).toBeNull();

		const anon = (await listPosts(t.db, { limit: 10 })).posts[0];
		expect(anon.mine).toEqual([]);
		expect(anon.reactions['👏']).toBe(2);
	});

	it('flags deactivated authors', async () => {
		await createPost(t.db, alice, { title: 'Title', body: 'hi' });
		await t.db.update(users).set({ active: false }).where(eq(users.id, alice));
		expect((await listPosts(t.db, { limit: 10 })).posts[0].author.deactivated).toBe(true);
	});

	it('aggregates correctly across a large page', async () => {
		const ids = await seedAt(30, (i) => new Date(Date.UTC(2026, 9, 16, 10, i)));
		await toggleReaction(t.db, bob, ids[0], '☕');
		const page = await listPosts(t.db, { limit: 30, viewerId: bob });
		expect(page.posts).toHaveLength(30);
		expect(page.posts[29].reactions['☕']).toBe(1);
		expect(page.posts[29].mine).toEqual(['☕']);
	});
});

describe('milestoneTitle', () => {
	it('maps the milestone chores to a sentence and falls back to the label', () => {
		expect(milestoneTitle('descale', 'Descale coffee machine')).toBe('Descaled the coffee machine');
		expect(milestoneTitle('deep_clean', 'Deep clean kitchen/fridge')).toBe(
			'Deep cleaned the kitchen and fridge'
		);
		expect(milestoneTitle('other', 'Some chore')).toBe('Some chore');
		expect([...milestoneTitle('other', 'x'.repeat(200))]).toHaveLength(80);
	});
});

describe('milestone posts', () => {
	async function descale() {
		const s = await submitPhotoTask(t.db, alice, 'descale', await img(), { uploadDir: dir });
		return s;
	}

	it('createPost is idempotent per milestone submission, even concurrently', async () => {
		const s = await descale();
		const results = await Promise.all([
			createPost(t.db, alice, { title: 'Title', body: 'a', imagePath: 'x.webp', milestoneSubmissionId: s.id }),
			createPost(t.db, alice, { title: 'Title', body: 'a', imagePath: 'x.webp', milestoneSubmissionId: s.id })
		]);
		expect(results[0].id).toBe(results[1].id);
		expect(await t.db.select().from(posts)).toHaveLength(1);
	});

	it('approving descale creates exactly one milestone post with the proof image', async () => {
		const s = await descale();
		await approve(t.db, admin, s.id, { onMilestone: onMilestonePost });
		const rows = await t.db.select().from(posts);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: alice,
			milestoneSubmissionId: s.id,
			imagePath: s.imagePath,
			title: 'Descaled the coffee machine',
			body: 'alice just did: Descale coffee machine! 🎉'
		});
		const feed = (await listPosts(t.db, { limit: 5 })).posts[0];
		expect(feed.title).toBe('Descaled the coffee machine');
		expect(feed.milestone).toEqual({ taskLabel: 'Descale coffee machine' });
		expect(feed.imagePath).toBe(s.imagePath);
		// the proof file is really there for /media
		expect((await readFile(join(dir, s.imagePath!))).length).toBeGreaterThan(0);
	});

	it('does not create a post for non-milestone tasks', async () => {
		const s = await submitPhotoTask(t.db, alice, 'beans', await img(), { uploadDir: dir });
		await approve(t.db, admin, s.id, { onMilestone: onMilestonePost });
		expect(await t.db.select().from(posts)).toHaveLength(0);
	});

	it('still posts for a milestone whose submitter was deactivated meanwhile', async () => {
		const s = await descale();
		await t.db.update(users).set({ active: false }).where(eq(users.id, alice));
		await approve(t.db, admin, s.id, { onMilestone: onMilestonePost });
		expect(await t.db.select().from(posts)).toHaveLength(1);
	});

	it('rolls the approval back when post creation fails', async () => {
		const s = await descale();
		await expect(
			approve(t.db, admin, s.id, {
				onMilestone: async (sub, tx) => {
					await createMilestonePost(tx, { ...sub, userId: 999999 });
				}
			})
		).rejects.toThrow();
		const [row] = await t.db.select().from(submissions).where(eq(submissions.id, s.id));
		expect(row.status).toBe('pending');
		expect(await t.db.select().from(posts)).toHaveLength(0);
	});
});
