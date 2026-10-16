import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { users } from '../../src/lib/server/db/schema';
import { bootstrapAdmin } from '../../src/lib/server/db/seed';
import { verifyPassword } from '../../src/lib/server/auth/hash';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

describe('bootstrapAdmin', () => {
	it('creates an admin once with a verifiable hash', async () => {
		await bootstrapAdmin(t.db, 'Admin', 'secret-pass-123');
		await bootstrapAdmin(t.db, 'admin', 'other-pass');
		const rows = await t.db.select().from(users);
		expect(rows).toHaveLength(1);
		expect(rows[0].role).toBe('admin');
		expect(rows[0].usernameNormalized).toBe('admin');
		expect(await verifyPassword(rows[0].passwordHash, 'secret-pass-123')).toBe(true);
	});
});
