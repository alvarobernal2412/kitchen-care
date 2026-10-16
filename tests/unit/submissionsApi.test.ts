import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { periods, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import { resetRateLimits } from '../../src/lib/server/ratelimit';

let t: TestDb;
vi.mock('$lib/server/db', () => ({ getDb: () => t.db }));

let userId: number;
let dir: string;

beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	const [u] = await t.db
		.insert(users)
		.values({ usernameNormalized: 'api', displayUsername: 'api', passwordHash: 'x' })
		.returning();
	userId = u.id;
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-api-'));
	process.env.UPLOAD_DIR = dir;
	resetRateLimits();
	await t.db.delete(submissions);
	await t.db.delete(periods);
	await createPeriod(t.db, 'Test');
});
afterEach(async () => {
	delete process.env.UPLOAD_DIR;
	await rm(dir, { recursive: true, force: true });
});

async function call(request: Request, authed = true) {
	const { POST } = await import('../../src/routes/api/submissions/+server');
	const res = await POST({
		locals: { user: authed ? { id: userId, active: true } : null },
		request
	} as unknown as Parameters<typeof POST>[0]);
	return { status: res.status, body: await res.json() };
}

const jsonReq = (body: unknown) =>
	new Request('http://x/api/submissions', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

async function multipart(taskKey: string, bytes?: Buffer) {
	const image =
		bytes ??
		(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#333' } })
			.jpeg()
			.toBuffer());
	const form = new FormData();
	form.set('taskKey', taskKey);
	form.set('image', new File([new Uint8Array(image)], 'p.jpg', { type: 'image/jpeg' }));
	// Like a browser: serialise first so Content-Length is present.
	const probe = new Response(form);
	const body = new Uint8Array(await probe.arrayBuffer());
	return new Request('http://x/api/submissions', {
		method: 'POST',
		headers: {
			'content-type': probe.headers.get('content-type')!,
			'content-length': String(body.length)
		},
		body
	});
}

describe('POST /api/submissions', () => {
	it('requires login', async () => {
		expect((await call(jsonReq({ taskKey: 'cutlery', detected: true }), false)).status).toBe(401);
	});

	it('creates a pending submission from a multipart upload', async () => {
		const r = await call(await multipart('beans'));
		expect(r).toEqual({ status: 201, body: { ok: true, status: 'pending' } });
		expect(await readdir(dir)).toHaveLength(1);
	});

	it('maps invalid images, wrong tasks and unknown tasks', async () => {
		expect((await call(await multipart('beans', Buffer.from('hello')))).status).toBe(422);
		expect((await call(await multipart('dishwasher'))).body.error).toBe('not_a_review_task');
		expect((await call(await multipart('nope'))).status).toBe(404);
		expect(await readdir(dir)).toHaveLength(0);
	});

	it('rejects an oversized body with 413 before reading it', async () => {
		const req = new Request('http://x/api/submissions', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '9000000' },
			body: 'x'
		});
		expect((await call(req)).status).toBe(413);
	});

	it('requires Content-Length on multipart (411)', async () => {
		const req = new Request('http://x/api/submissions', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=x' },
			body: 'x'
		});
		expect(req.headers.get('content-length')).toBeNull();
		const r = await call(req);
		expect(r).toEqual({ status: 411, body: { error: 'length_required' } });
	});

	it('rejects a declared length just over 5.5 MB (413) and accepts one under', async () => {
		const req = (len: number) =>
			new Request('http://x/api/submissions', {
				method: 'POST',
				headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(len) },
				body: 'x'
			});
		expect((await call(req(5.5 * 1024 * 1024 + 1))).status).toBe(413);
		expect((await call(req(1024))).status).toBe(400); // passes the size gate, then bad form
	});

	it('credits cutlery once detected, and cools down', async () => {
		const ok = await call(jsonReq({ taskKey: 'cutlery', detected: true }));
		expect(ok).toEqual({ status: 200, body: { ok: true, pointsAwarded: 1, newTotal: 1 } });
		const again = await call(jsonReq({ taskKey: 'cutlery', detected: true }));
		expect(again.status).toBe(409);
		expect(again.body.error).toBe('cooldown');
		expect(again.body.retryAfterSeconds).toBeGreaterThan(0);
	});

	it('refuses cutlery when not detected', async () => {
		const r = await call(jsonReq({ taskKey: 'cutlery', detected: false }));
		expect(r).toEqual({ status: 422, body: { error: 'detection_failed' } });
	});
});
