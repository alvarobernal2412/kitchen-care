import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { sessions, users } from '../../src/lib/server/db/schema';
import { AuthError, UsernameTakenError, signUp } from '../../src/lib/server/auth/users';
import { changeUsername } from '../../src/lib/server/auth/account';
import { getSessionUser, login } from '../../src/lib/server/auth/session';
import { InactiveUserError } from '../../src/lib/server/tasks';

const PW = 'Abcdef1!';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

async function mk(name: string) {
	return signUp(t.db, { username: name, password: PW, classification: 'Student' });
}
const row = async (id: number) => (await t.db.select().from(users).where(eq(users.id, id)))[0];

async function code(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err).toBeInstanceOf(AuthError);
	return (err as AuthError).code;
}

describe('changeUsername', () => {
	it('changes the name, keeping the typed casing and normalising the key', async () => {
		const u = await mk('cu-ok');
		await changeUsername(t.db, u.id, PW, '  Cu-New.Name  ');
		const r = await row(u.id);
		expect(r.displayUsername).toBe('Cu-New.Name');
		expect(r.usernameNormalized).toBe('cu-new.name');
	});

	it('allows a case-only change of your own name', async () => {
		const u = await mk('lena');
		await changeUsername(t.db, u.id, PW, 'Lena');
		const r = await row(u.id);
		expect(r.displayUsername).toBe('Lena');
		expect(r.usernameNormalized).toBe('lena');
	});

	it('is a no-op for an identical name', async () => {
		const u = await mk('cu-same');
		await expect(changeUsername(t.db, u.id, PW, 'cu-same')).resolves.toBeUndefined();
		expect((await row(u.id)).displayUsername).toBe('cu-same');
	});

	it('rejects a name used by another user, case-insensitively', async () => {
		await mk('cu-taken');
		const u = await mk('cu-b1');
		await expect(changeUsername(t.db, u.id, PW, 'CU-Taken')).rejects.toBeInstanceOf(
			UsernameTakenError
		);
		await expect(changeUsername(t.db, u.id, PW, '  cu-taken  ')).rejects.toBeInstanceOf(
			UsernameTakenError
		);
		expect((await row(u.id)).displayUsername).toBe('cu-b1');
	});

	it.each([
		['with a space', 'has space'],
		['with a non-ASCII letter', 'häns'],
		['with @', 'a@bcd'],
		['2 chars', 'ab'],
		['33 chars', 'a'.repeat(33)]
	])('rejects an invalid name (%s)', async (_label, bad) => {
		const u = await mk(`cu-inv-${Math.random().toString(36).slice(2, 8)}`);
		expect(await code(changeUsername(t.db, u.id, PW, bad))).toBe('invalid_username');
	});

	it('accepts the 3 and 32 character boundaries', async () => {
		const u = await mk('cu-bound');
		await changeUsername(t.db, u.id, PW, 'abc');
		expect((await row(u.id)).displayUsername).toBe('abc');
		await changeUsername(t.db, u.id, PW, 'b'.repeat(32));
		expect((await row(u.id)).displayUsername).toBe('b'.repeat(32));
	});

	it('rejects a wrong or empty current password and changes nothing', async () => {
		const u = await mk('cu-wrongpw');
		expect(await code(changeUsername(t.db, u.id, 'Nope1234!', 'cu-other'))).toBe('wrong_password');
		expect(await code(changeUsername(t.db, u.id, '', 'cu-other'))).toBe('wrong_password');
		expect((await row(u.id)).displayUsername).toBe('cu-wrongpw');
	});

	it('rejects a deactivated user', async () => {
		const u = await mk('cu-off');
		await t.db.update(users).set({ active: false }).where(eq(users.id, u.id));
		await expect(changeUsername(t.db, u.id, PW, 'cu-off2')).rejects.toBeInstanceOf(
			InactiveUserError
		);
		expect((await row(u.id)).displayUsername).toBe('cu-off');
	});

	it('rejects an unknown user', async () => {
		expect(await code(changeUsername(t.db, 999999, PW, 'cu-ghost'))).toBe('wrong_password');
	});

	it('lets exactly one of two concurrent changes to the same free name win', async () => {
		const a = await mk('cu-race-a');
		const b = await mk('cu-race-b');
		const results = await Promise.allSettled([
			changeUsername(t.db, a.id, PW, 'cu-race-target'),
			changeUsername(t.db, b.id, PW, 'Cu-Race-Target')
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(lost.reason).toBeInstanceOf(UsernameTakenError);
	});

	it('frees the old name for others', async () => {
		const a = await mk('cu-old');
		await changeUsername(t.db, a.id, PW, 'cu-old-moved');
		await expect(mk('cu-old')).resolves.toBeTruthy();
	});

	it('logs in with the new name only, and keeps sessions valid', async () => {
		const u = await mk('cu-login');
		const { sessionId } = await login(t.db, 'cu-login', PW);
		await changeUsername(t.db, u.id, PW, 'cu-login-new');
		await expect(login(t.db, 'cu-login-new', PW)).resolves.toBeDefined();
		expect(await code(login(t.db, 'cu-login', PW))).toBe('invalid_credentials');
		const su = await getSessionUser(t.db, sessionId);
		expect(su?.id).toBe(u.id);
		expect(su?.displayUsername).toBe('cu-login-new');
		expect(await t.db.select().from(sessions).where(eq(sessions.userId, u.id))).not.toHaveLength(0);
	});
});
