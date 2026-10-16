import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { tasks } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

describe('seedTasks', () => {
	it('is idempotent and seeds the task table values', async () => {
		await seedTasks(t.db);
		await seedTasks(t.db);
		const rows = await t.db.select().from(tasks);
		expect(rows).toHaveLength(7);
		const get = async (key: string) =>
			(await t.db.select().from(tasks).where(eq(tasks.key, key)))[0];
		expect((await get('descale')).points).toBe(10);
		expect((await get('dishwasher')).cooldownSeconds).toBe(9000);
		expect((await get('cutlery')).persistPhoto).toBe(false);
		expect((await get('beans')).needsReview).toBe(true);
	});
});
