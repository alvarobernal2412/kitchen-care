import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { comments, posts, reactions, users } from '../../src/lib/server/db/schema';
import { EMOJIS, EMOJI_NAMES, reactionLabel } from '../../src/lib/emoji';
import { createPost } from '../../src/lib/server/feed';
import { resetRateLimits } from '../../src/lib/server/ratelimit';

let t: TestDb;
vi.mock('$lib/server/db', () => ({ getDb: () => t.db }));

type U = { id: number; displayUsername: string; active: boolean } | null;
let alice: NonNullable<U>;
let bob: NonNullable<U>;

beforeAll(async () => {
	t = await getTestDb();
	const mk = async (name: string) => {
		const [u] = await t.db
			.insert(users)
			.values({ usernameNormalized: name, displayUsername: name, passwordHash: 'x' })
			.returning();
		return { ...u, active: true };
	};
	alice = await mk('alice');
	bob = await mk('bob');
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	resetRateLimits();
	await t.db.delete(reactions);
	await t.db.delete(comments);
	await t.db.delete(posts);
});

type Handler = (e: unknown) => Promise<Response>;
async function call(
	mod: Record<string, unknown>,
	method: string,
	user: U,
	id: string,
	body?: unknown
) {
	const request = new Request('http://localhost/x', {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const res = await (mod[method] as Handler)({ locals: { user }, params: { id }, request });
	return { status: res.status, body: await res.json() };
}

const reactionsRoute = () => import('../../src/routes/api/posts/[id]/reactions/+server');
const commentsRoute = () => import('../../src/routes/api/posts/[id]/comments/+server');
const postRoute = () => import('../../src/routes/api/posts/[id]/+server');
const commentRoute = () => import('../../src/routes/api/comments/[id]/+server');

describe('POST /api/posts/[id]/reactions', () => {
	it('401 anonymous, 403 inactive', async () => {
		const m = await reactionsRoute();
		expect((await call(m, 'POST', null, '1', { emoji: '👏' })).status).toBe(401);
		expect((await call(m, 'POST', { ...bob, active: false }, '1', { emoji: '👏' })).status).toBe(
			403
		);
	});

	it('validates id, emoji and existence', async () => {
		const m = await reactionsRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		expect((await call(m, 'POST', bob, 'abc', { emoji: '👏' })).status).toBe(404);
		expect((await call(m, 'POST', bob, '999999', { emoji: '👏' })).status).toBe(404);
		expect((await call(m, 'POST', bob, String(p.id), { emoji: '👍' })).status).toBe(400);
		expect((await call(m, 'POST', bob, String(p.id), {})).status).toBe(400);
	});

	it('toggles and returns counts + own reactions', async () => {
		const m = await reactionsRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		const on = await call(m, 'POST', bob, String(p.id), { emoji: '☕' });
		expect(on.status).toBe(200);
		expect(on.body.counts['☕']).toBe(1);
		expect(on.body.mine).toEqual(['☕']);
		const off = await call(m, 'POST', bob, String(p.id), { emoji: '☕' });
		expect(off.body.counts['☕']).toBe(0);
	});

	it('rate limits at 60/min', async () => {
		const m = await reactionsRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		for (let i = 0; i < 60; i++) await call(m, 'POST', bob, String(p.id), { emoji: '👏' });
		expect((await call(m, 'POST', bob, String(p.id), { emoji: '👏' })).status).toBe(429);
	});
});

describe('comments API', () => {
	it('requires login for GET and POST', async () => {
		const m = await commentsRoute();
		expect((await call(m, 'GET', null, '1')).status).toBe(401);
		expect((await call(m, 'POST', null, '1', { body: 'x' })).status).toBe(401);
	});

	it('adds, lists and validates', async () => {
		const m = await commentsRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		const id = String(p.id);
		const created = await call(m, 'POST', bob, id, { body: '<b>hey</b>' });
		expect(created.status).toBe(201);
		expect(created.body.comment).toMatchObject({ body: '<b>hey</b>', author: { id: bob.id } });
		expect((await call(m, 'POST', bob, id, { body: '' })).status).toBe(422);
		expect((await call(m, 'POST', bob, id, { body: 'a'.repeat(301) })).status).toBe(422);
		expect((await call(m, 'POST', bob, id, { nope: 1 })).status).toBe(400);
		expect((await call(m, 'POST', bob, '999999', { body: 'x' })).status).toBe(404);
		const list = await call(m, 'GET', alice, id);
		expect(list.body.comments).toHaveLength(1);
		expect((await call(m, 'GET', alice, '999999')).status).toBe(404);
	});

	it('rate limits comments at 10/min', async () => {
		const m = await commentsRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		for (let i = 0; i < 10; i++) await call(m, 'POST', bob, String(p.id), { body: 'x' });
		expect((await call(m, 'POST', bob, String(p.id), { body: 'x' })).status).toBe(429);
	});
});

describe('DELETE endpoints', () => {
	it('post: 401, 403 for non-author, 404 missing, 200 for author', async () => {
		const m = await postRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		const id = String(p.id);
		expect((await call(m, 'DELETE', null, id)).status).toBe(401);
		expect((await call(m, 'DELETE', bob, id)).status).toBe(403);
		expect((await call(m, 'DELETE', alice, '999999')).status).toBe(404);
		expect((await call(m, 'DELETE', alice, id)).status).toBe(200);
		expect(await t.db.select().from(posts)).toHaveLength(0);
	});

	it('comment: 403 for non-author, 200 for author', async () => {
		const cm = await commentsRoute();
		const m = await commentRoute();
		const p = await createPost(t.db, alice.id, { title: 'Title', body: 'hi' });
		const c = await call(cm, 'POST', bob, String(p.id), { body: 'mine' });
		const id = String(c.body.comment.id);
		expect((await call(m, 'DELETE', alice, id)).status).toBe(403);
		expect((await call(m, 'DELETE', bob, id)).status).toBe(200);
		expect((await call(m, 'DELETE', bob, id)).status).toBe(404);
	});
});

describe('reaction buttons accessibility', () => {
	it('every emoji has a human name and an accessible label', () => {
		for (const e of EMOJIS) {
			expect(EMOJI_NAMES[e].length).toBeGreaterThan(0);
			expect(reactionLabel(e, 3)).toBe(`${EMOJI_NAMES[e]}, 3 reactions`);
		}
		expect(reactionLabel('👏', 1)).toBe('Clap, 1 reaction');
		expect(reactionLabel('👏', 0)).toBe('Clap, no reactions');
	});

	it('the button in Reactions.svelte sets aria-label from reactionLabel and aria-pressed', async () => {
		const src = await readFile('src/lib/components/Reactions.svelte', 'utf8');
		expect(src).toMatch(/<button[^>]*aria-label=\{reactionLabel\(emoji, current\[emoji\]\)\}/s);
		expect(src).toMatch(/<button[^>]*aria-pressed=/s);
		expect(src).toMatch(/<button[^>]*disabled=\{pending\}/s);
	});
});

describe('feed UI safety', () => {
	it('never renders user content with {@html}', async () => {
		for (const f of [
			'src/lib/components/Post.svelte',
			'src/lib/components/Reactions.svelte',
			'src/lib/components/Comments.svelte',
			'src/routes/(app)/feed/+page.svelte'
		]) {
			expect(await readFile(f, 'utf8')).not.toContain('@html');
		}
	});
});

describe('feed page', () => {
	async function mod() {
		return import('../../src/routes/(app)/feed/+page.server');
	}

	const post = async (fields: { title?: string; body?: string }, user: U = alice) => {
		const { actions } = await mod();
		const fd = new FormData();
		if (fields.title !== undefined) fd.set('title', fields.title);
		if (fields.body !== undefined) fd.set('body', fields.body);
		const request = new Request('http://localhost/feed?/post', { method: 'POST', body: fd });
		return (actions.post as (e: unknown) => Promise<{ status?: number; data?: Record<string, unknown> }>)({
			request,
			locals: { user }
		});
	};

	it('post action creates a post, validates, and rate limits at 5/min', async () => {
		expect(await post({ title: 'Greeting', body: 'hello' })).toEqual({ posted: true });
		expect((await t.db.select().from(posts))[0]).toMatchObject({ title: 'Greeting', body: 'hello' });
		expect((await post({ title: 'T', body: '' })).status).toBe(400);
		expect((await post({ title: 'T', body: 'x'.repeat(501) })).status).toBe(400);
		expect((await post({ title: 'T', body: 'hi' }, null)).status).toBe(401);
		expect((await post({ title: 'T', body: 'hi' }, { ...alice, active: false })).status).toBe(403);
		resetRateLimits();
		for (let i = 0; i < 5; i++) await post({ title: 'T', body: `p${i}` });
		expect((await post({ title: 'T', body: 'too many' })).status).toBe(429);
	});

	it('post action reports a missing title and keeps what was typed', async () => {
		const r = await post({ title: '   ', body: 'some body' });
		expect(r.status).toBe(400);
		expect(r.data).toMatchObject({ titleError: 'Title cannot be empty', title: '   ', body: 'some body' });
		expect(r.data?.bodyError).toBeUndefined();
		const noField = await post({ body: 'some body' });
		expect(noField.status).toBe(400);
		expect(noField.data).toMatchObject({ titleError: 'Title cannot be empty' });
		expect(await t.db.select().from(posts)).toHaveLength(0);
	});

	it('post action rejects a title over 80 characters', async () => {
		const r = await post({ title: 't'.repeat(81), body: 'b' });
		expect(r.status).toBe(400);
		expect(r.data).toMatchObject({ titleError: 'Title is too long (80 characters max)', body: 'b' });
		expect((await post({ title: 't'.repeat(80), body: 'b' })).data).toBeUndefined();
	});

	it('post action reports both missing fields at once', async () => {
		const r = await post({ title: '', body: '' });
		expect(r.status).toBe(400);
		expect(r.data).toMatchObject({
			titleError: 'Title cannot be empty',
			bodyError: 'Post cannot be empty'
		});
		expect((await post({})).status).toBe(400);
	});

	it('invalid submissions do not use up the post rate limit', async () => {
		for (let i = 0; i < 6; i++) await post({ title: '', body: '' });
		expect(await post({ title: 'T', body: 'fine' })).toEqual({ posted: true });
	});

	it('load returns the first page with a cursor and serialisable dates', async () => {
		const { load } = await mod();
		for (let i = 0; i < 22; i++) await createPost(t.db, alice.id, { title: 'Title', body: `p${i}` });
		const run = (url: string) =>
			(load as (e: unknown) => Promise<{ posts: { body: string }[]; next: null | { before: string; beforeId: number }; paged: boolean }>)({
				locals: { user: alice },
				url: new URL(url)
			});
		const first = await run('http://localhost/feed');
		expect(first.posts).toHaveLength(20);
		expect(first.paged).toBe(false);
		expect(first.next).not.toBeNull();
		const second = await run(
			`http://localhost/feed?before=${encodeURIComponent(first.next!.before)}&beforeId=${first.next!.beforeId}`
		);
		expect(second.paged).toBe(true);
		expect(second.posts.map((p) => p.body)).toEqual(['p1', 'p0']);
		expect(second.next).toBeNull();
		// garbage cursor falls back to the first page
		expect((await run('http://localhost/feed?before=nope')).posts).toHaveLength(20);
		const ok = 'before=2026-10-16T00:00:00Z';
		for (const q of [
			`${ok}&beforeId=99999999999`,
			`${ok}&beforeId=2147483648`,
			`${ok}&beforeId=-5`,
			`${ok}&beforeId=0`,
			`${ok}&beforeId=1.5`,
			`${ok}&beforeId=abc`,
			'before=0000-01-01T00:00:00Z',
			'before=1969-12-31T23:59:59Z',
			'before=9999-12-31T00:00:00Z',
			'beforeId=5'
		]) {
			const r = await run(`http://localhost/feed?${q}`);
			expect(r.paged, q).toBe(false);
			expect(r.posts, q).toHaveLength(20);
		}
	});
});
