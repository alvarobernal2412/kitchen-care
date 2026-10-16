import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, users } from '../../src/lib/server/db/schema';
import {
	APP_OPEN_WINDOW_MS,
	recordAppOpen,
	resetAppOpenThrottle,
	shouldRecordAppOpen
} from '../../src/lib/server/events';

let t: TestDb;
let u1: number;
let u2: number;

beforeAll(async () => {
	t = await getTestDb();
	const rows = await t.db
		.insert(users)
		.values([
			{ usernameNormalized: 'a', displayUsername: 'a', passwordHash: 'x' },
			{ usernameNormalized: 'b', displayUsername: 'b', passwordHash: 'x' }
		])
		.returning();
	[u1, u2] = rows.map((r) => r.id);
});
afterAll(async () => t.close());
beforeEach(async () => {
	resetAppOpenThrottle();
	await t.db.delete(events);
});

const count = async (userId: number) =>
	(await t.db.select().from(events).where(eq(events.userId, userId))).length;

describe('recordAppOpen', () => {
	const t0 = new Date('2026-10-16T10:00:00Z');

	it('writes once, then throttles within 30 minutes', async () => {
		expect(await recordAppOpen(t.db, u1, t0)).toBe(true);
		expect(await recordAppOpen(t.db, u1, new Date(t0.getTime() + APP_OPEN_WINDOW_MS - 1))).toBe(
			false
		);
		expect(await count(u1)).toBe(1);
	});

	it('writes again once 30 minutes have passed', async () => {
		await recordAppOpen(t.db, u1, t0);
		expect(await recordAppOpen(t.db, u1, new Date(t0.getTime() + APP_OPEN_WINDOW_MS))).toBe(true);
		expect(await count(u1)).toBe(2);
	});

	it('throttles per user', async () => {
		expect(await recordAppOpen(t.db, u1, t0)).toBe(true);
		expect(await recordAppOpen(t.db, u2, t0)).toBe(true);
		expect(await count(u2)).toBe(1);
	});

	it('records the event with the given time and type', async () => {
		await recordAppOpen(t.db, u1, t0);
		const [row] = await t.db.select().from(events);
		expect(row.type).toBe('app_open');
		expect(row.createdAt.toISOString()).toBe(t0.toISOString());
	});

	it('does not stay throttled when the insert fails', async () => {
		await expect(recordAppOpen(t.db, 999_999, t0)).rejects.toThrow();
		// the failed attempt left no throttle entry, so an immediate retry is attempted again
		await expect(recordAppOpen(t.db, 999_999, t0)).rejects.toThrow();
		expect(await recordAppOpen(t.db, u1, t0)).toBe(true);
	});
});

describe('shouldRecordAppOpen', () => {
	const should = (path: string, method = 'GET', accept = 'text/html,application/xhtml+xml') =>
		shouldRecordAppOpen(
			new Request(`http://x${path}`, { method, headers: { accept } }),
			new URL(`http://x${path}`)
		);

	it('accepts document GETs', () => {
		expect(should('/')).toBe(true);
		expect(should('/leaderboard?x=1')).toBe(true);
		expect(should('/admin/analytics')).toBe(true);
	});
	it('accepts SvelteKit client-navigation data requests', () => {
		expect(should('/leaderboard/__data.json', 'GET', '*/*')).toBe(true);
	});
	it('rejects api, media, healthz, assets', () => {
		expect(should('/api/tasks/dishwasher')).toBe(false);
		expect(should('/api')).toBe(false);
		expect(should('/media/abc.webp', 'GET', 'image/*')).toBe(false);
		expect(should('/healthz')).toBe(false);
		expect(should('/_app/immutable/x.js', 'GET', '*/*')).toBe(false);
	});
	it('rejects non-GET and non-document requests', () => {
		expect(should('/', 'POST')).toBe(false);
		expect(should('/?/logTask', 'POST')).toBe(false);
		expect(should('/', 'GET', 'application/json')).toBe(false);
		expect(should('/', 'HEAD')).toBe(false);
	});
});
