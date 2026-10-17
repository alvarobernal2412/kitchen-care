import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { events, posts, sessions, submissions, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { collectDatabase } from '../../src/lib/server/system/database';
import { collectActivity } from '../../src/lib/server/system/activity';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

describe('collectDatabase', () => {
	it('reports size, largest tables, connections and a response time', async () => {
		const r = await collectDatabase(t.db);
		expect(r.reachable).toBe(true);
		if (!r.reachable) return;
		expect(r.sizeBytes).toBeGreaterThan(0);
		expect(r.tables.length).toBeGreaterThan(0);
		expect(r.tables.length).toBeLessThanOrEqual(5);
		const names = r.tables.map((x) => x.name);
		expect(names.every((n) => ['users', 'sessions', 'submissions', 'events', 'posts', 'comments', 'tasks', 'periods', 'reactions', 'period_winners', 'reset_tokens'].includes(n))).toBe(true);
		const sizes = r.tables.map((x) => x.totalBytes);
		expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
		for (const tbl of r.tables) expect(tbl.rowEstimate).toBeGreaterThanOrEqual(0);
		expect(r.connections).toBeGreaterThanOrEqual(1);
		expect(r.maxConnections).toBeGreaterThan(0);
		expect(typeof r.responseMs).toBe('number');
		expect(r.responseMs).toBeGreaterThanOrEqual(0);
	});

	it('returns an unreachable result instead of throwing when the connection is closed', async () => {
		const closed = await getTestDb();
		await closed.close();
		const r = await collectDatabase(closed.db);
		expect(r).toEqual({ reachable: false });
	});
});

describe('collectActivity', () => {
	it('counts users, sessions, pending submissions, events, posts and comments', async () => {
		await seedTasks(t.db);
		const [u1] = await t.db
			.insert(users)
			.values({ usernameNormalized: 'sys-a', displayUsername: 'sys-a', passwordHash: 'x' })
			.returning();
		await t.db
			.insert(users)
			.values({ usernameNormalized: 'sys-b', displayUsername: 'sys-b', passwordHash: 'x', active: false });
		await t.db.insert(sessions).values([
			{ id: 's1', userId: u1.id, expiresAt: new Date(Date.now() + 3600_000) },
			{ id: 's2', userId: u1.id, expiresAt: new Date(Date.now() - 3600_000) }
		]);
		await t.db.insert(submissions).values({ userId: u1.id, taskKey: 'cutlery', status: 'pending' });
		await t.db.insert(events).values([
			{ userId: u1.id, type: 'open' },
			{ userId: u1.id, type: 'open', createdAt: new Date(Date.now() - 3 * 86400_000) }
		]);
		await t.db.insert(posts).values({ userId: u1.id, title: 't', body: 'b' });

		const a = await collectActivity(t.db);
		expect(a.usersTotal).toBe(2);
		expect(a.usersActive).toBe(1);
		expect(a.liveSessions).toBe(1);
		expect(a.pendingSubmissions).toBe(1);
		expect(a.eventsLast24h).toBe(1);
		expect(a.submissionsLast24h).toBe(1);
		expect(a.posts).toBe(1);
		expect(a.comments).toBe(0);
	});
});
