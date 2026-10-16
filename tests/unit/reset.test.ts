import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { resetTokens, sessions, users } from '../../src/lib/server/db/schema';
import { AuthError, signUp } from '../../src/lib/server/auth/users';
import { login } from '../../src/lib/server/auth/session';
import {
	ResetError,
	buildResetUrl,
	consumeResetToken,
	createResetToken
} from '../../src/lib/server/auth/reset';

const PW = 'Abcdef1!';
const NEW_PW = 'Zyxwvu9#Better';
const MIN = 60 * 1000;

let t: TestDb;
let adminId: number;
let seq = 0;

beforeAll(async () => {
	t = await getTestDb();
	adminId = (await newUser('admin1')).id;
	await t.db.update(users).set({ role: 'admin' }).where(eq(users.id, adminId));
});
afterAll(async () => {
	await t.close();
});

async function newUser(name = `user${++seq}`) {
	return signUp(t.db, { username: name, password: PW, classification: 'Student' });
}

async function rejectsInvalid(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err).toBeInstanceOf(ResetError);
	expect((err as ResetError).code).toBe('invalid_token');
}

describe('createResetToken / consumeResetToken', () => {
	it('works once, then the same token is rejected', async () => {
		const u = await newUser();
		const token = await createResetToken(t.db, adminId, u.id);
		await consumeResetToken(t.db, token, NEW_PW);
		await expect(login(t.db, u.usernameNormalized, NEW_PW)).resolves.toBeTruthy();
		await expect(login(t.db, u.usernameNormalized, PW)).rejects.toBeInstanceOf(AuthError);
		await rejectsInvalid(consumeResetToken(t.db, token, 'Another1!Pass'));
	});

	it('rejects unknown tokens with the same error', async () => {
		await rejectsInvalid(consumeResetToken(t.db, 'f'.repeat(64), NEW_PW));
	});

	it('is valid at +59 min and invalid at +60 and +61 min', async () => {
		const u = await newUser();
		const now = new Date();
		const ok = await createResetToken(t.db, adminId, u.id, now);
		await consumeResetToken(t.db, ok, NEW_PW, new Date(now.getTime() + 59 * MIN));

		const at60 = await createResetToken(t.db, adminId, u.id, now);
		await rejectsInvalid(consumeResetToken(t.db, at60, NEW_PW, new Date(now.getTime() + 60 * MIN)));
		const at61 = await createResetToken(t.db, adminId, u.id, now);
		await rejectsInvalid(consumeResetToken(t.db, at61, NEW_PW, new Date(now.getTime() + 61 * MIN)));
	});

	it("rejects a deactivated user's token", async () => {
		const u = await newUser();
		const token = await createResetToken(t.db, adminId, u.id);
		await t.db.update(users).set({ active: false }).where(eq(users.id, u.id));
		await rejectsInvalid(consumeResetToken(t.db, token, NEW_PW));
	});

	it('does not consume the token on a weak password', async () => {
		const u = await newUser();
		const token = await createResetToken(t.db, adminId, u.id);
		const err = await consumeResetToken(t.db, token, 'weak').then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(AuthError);
		expect((err as AuthError).code).toBe('weak_password');
		await consumeResetToken(t.db, token, NEW_PW);
		await expect(login(t.db, u.usernameNormalized, NEW_PW)).resolves.toBeTruthy();
	});

	it("revokes all of the user's sessions but not another user's", async () => {
		const u = await newUser();
		const other = await newUser();
		await login(t.db, u.usernameNormalized, PW);
		await login(t.db, u.usernameNormalized, PW);
		await login(t.db, other.usernameNormalized, PW);
		const token = await createResetToken(t.db, adminId, u.id);
		await consumeResetToken(t.db, token, NEW_PW);
		expect(await t.db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
		expect(await t.db.select().from(sessions).where(eq(sessions.userId, other.id))).toHaveLength(1);
	});

	it('refuses a non-admin actor and an unknown target', async () => {
		const a = await newUser();
		const b = await newUser();
		await expect(createResetToken(t.db, a.id, b.id)).rejects.toBeInstanceOf(ResetError);
		await expect(createResetToken(t.db, adminId, 999999)).rejects.toBeInstanceOf(ResetError);
		await t.db.update(users).set({ role: 'admin', active: false }).where(eq(users.id, a.id));
		await expect(createResetToken(t.db, a.id, b.id)).rejects.toBeInstanceOf(ResetError);
	});

	it('invalidates the earlier token when a new one is created', async () => {
		const u = await newUser();
		const first = await createResetToken(t.db, adminId, u.id);
		const second = await createResetToken(t.db, adminId, u.id);
		await rejectsInvalid(consumeResetToken(t.db, first, NEW_PW));
		await consumeResetToken(t.db, second, NEW_PW);
	});

	it('leaves exactly one valid token after concurrent creations for the same user', async () => {
		const u = await newUser();
		const tokens = await Promise.all(
			Array.from({ length: 6 }, () => createResetToken(t.db, adminId, u.id))
		);
		const rows = await t.db.select().from(resetTokens).where(eq(resetTokens.userId, u.id));
		expect(rows).toHaveLength(1);
		const results = await Promise.allSettled(
			tokens.map((tok, i) => consumeResetToken(t.db, tok, `Zyxwvu9#Better${i}`))
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
	});

	it('lets exactly one of two concurrent consumes succeed', async () => {
		const u = await newUser();
		const token = await createResetToken(t.db, adminId, u.id);
		const results = await Promise.allSettled([
			consumeResetToken(t.db, token, NEW_PW),
			consumeResetToken(t.db, token, 'Qwerty7$Other')
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason).toBeInstanceOf(ResetError);
	});

	it('never stores the raw token', async () => {
		const u = await newUser();
		const token = await createResetToken(t.db, adminId, u.id);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		const rows = await t.db.select().from(resetTokens).where(eq(resetTokens.userId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).not.toBe(token);
		expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('buildResetUrl', () => {
	it('joins origin and token', () => {
		expect(buildResetUrl('https://kc.example', 'abc123')).toBe(
			'https://kc.example/reset-password?token=abc123'
		);
	});
	it('tolerates a trailing slash and encodes the token', () => {
		expect(buildResetUrl('https://kc.example/', 'a b')).toBe(
			'https://kc.example/reset-password?token=a%20b'
		);
	});
});
