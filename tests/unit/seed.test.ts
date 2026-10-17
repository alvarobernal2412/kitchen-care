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
		expect(rows).toHaveLength(8); // the seven chores plus the welcome bonus ledger entry
		expect(rows.filter((r) => r.key !== 'welcome_bonus')).toHaveLength(7);
		const get = async (key: string) =>
			(await t.db.select().from(tasks).where(eq(tasks.key, key)))[0];
		expect((await get('descale')).points).toBe(10);
		expect((await get('dishwasher')).cooldownSeconds).toBe(9000);
		expect((await get('cutlery')).persistPhoto).toBe(false);
		expect((await get('beans')).needsReview).toBe(true);
		expect(await get('welcome_bonus')).toMatchObject({
			label: 'Welcome bonus',
			points: 10,
			cooldownSeconds: 0,
			requiresPhoto: false,
			persistPhoto: false,
			needsReview: false,
			milestone: false
		});
	});
});
