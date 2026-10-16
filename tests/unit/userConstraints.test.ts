import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { users } from '../../src/lib/server/db/schema';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

const base = { displayUsername: 'x', passwordHash: 'h' };
// Cast: the TS enum already blocks bad values, we want to prove the DB does too.
const insert = (n: string, extra: Record<string, unknown>) =>
	t.db.insert(users).values({ ...base, usernameNormalized: n, ...extra } as never);

describe('users classification/department constraints', () => {
	it('accepts valid values', async () => {
		await insert('ok1', {
			classification: 'Employee',
			department: 'Interactions Research Group'
		});
		await insert('ok2', { classification: 'Student' });
		await insert('ok3', {});
	});

	it('rejects lowercase classification', async () => {
		await expect(insert('bad1', { classification: 'student' })).rejects.toThrow();
	});

	it('rejects unknown department', async () => {
		await expect(
			insert('bad2', { classification: 'Employee', department: 'Marketing' })
		).rejects.toThrow();
	});
});
