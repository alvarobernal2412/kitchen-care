import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { periods } from '../../src/lib/server/db/schema';
import {
	ActivePeriodExistsError,
	createPeriod,
	getActivePeriod
} from '../../src/lib/server/periods';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

describe('periods', () => {
	it('has no active period initially', async () => {
		expect(await getActivePeriod(t.db)).toBeNull();
	});

	it('creates an active period, rejects a second, allows one after ending', async () => {
		const p = await createPeriod(t.db, 'October');
		expect(p.status).toBe('active');
		expect((await getActivePeriod(t.db))?.id).toBe(p.id);

		await expect(createPeriod(t.db, 'Again')).rejects.toBeInstanceOf(ActivePeriodExistsError);

		await t.db
			.update(periods)
			.set({ status: 'ended', endsAt: new Date() })
			.where(eq(periods.id, p.id));
		expect(await getActivePeriod(t.db)).toBeNull();
		const next = await createPeriod(t.db, 'November');
		expect(next.id).not.toBe(p.id);
	});
});
