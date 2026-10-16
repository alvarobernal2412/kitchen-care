import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { sessions, users } from '../../src/lib/server/db/schema';
import { AuthError, signUp } from '../../src/lib/server/auth/users';
import { changePassword } from '../../src/lib/server/auth/account';
import { getSessionUser, login } from '../../src/lib/server/auth/session';

const OLD = 'Abcdef1!';
const NEW = 'Zyxwvu9#';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

async function newUser(name: string) {
	const u = await signUp(t.db, { username: name, password: OLD, classification: 'Student' });
	const current = (await login(t.db, name, OLD)).sessionId;
	const other = (await login(t.db, name, OLD)).sessionId;
	return { u, current, other };
}

async function code(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err).toBeInstanceOf(AuthError);
	return (err as AuthError).code;
}

describe('changePassword', () => {
	it('rejects a wrong current password and changes nothing', async () => {
		const { u, current, other } = await newUser('cp-wrong');
		const [before] = await t.db.select().from(users).where(eq(users.id, u.id));
		expect(await code(changePassword(t.db, u.id, 'Nope1234!', NEW, current))).toBe('wrong_password');
		const [after] = await t.db.select().from(users).where(eq(users.id, u.id));
		expect(after.passwordHash).toBe(before.passwordHash);
		expect(await getSessionUser(t.db, other)).not.toBeNull();
	});

	it('rejects a weak new password', async () => {
		const { u, current } = await newUser('cp-weak');
		expect(await code(changePassword(t.db, u.id, OLD, 'short', current))).toBe('weak_password');
		await expect(login(t.db, 'cp-weak', OLD)).resolves.toBeDefined();
	});

	it('changes the hash, revokes other sessions, keeps the current one, and the new password logs in', async () => {
		const { u, current, other } = await newUser('cp-ok');
		const [before] = await t.db.select().from(users).where(eq(users.id, u.id));
		await changePassword(t.db, u.id, OLD, NEW, current);
		const [after] = await t.db.select().from(users).where(eq(users.id, u.id));
		expect(after.passwordHash).not.toBe(before.passwordHash);
		expect(await getSessionUser(t.db, current)).not.toBeNull();
		expect(await getSessionUser(t.db, other)).toBeNull();
		await expect(login(t.db, 'cp-ok', NEW)).resolves.toBeDefined();
		await expect(login(t.db, 'cp-ok', OLD)).rejects.toBeInstanceOf(AuthError);
	});

	it('does not touch other users sessions', async () => {
		const a = await newUser('cp-a');
		const b = await newUser('cp-b');
		await changePassword(t.db, a.u.id, OLD, NEW, a.current);
		expect(await getSessionUser(t.db, b.current)).not.toBeNull();
		const rows = await t.db.select().from(sessions).where(eq(sessions.userId, b.u.id));
		expect(rows).toHaveLength(2);
	});
});
