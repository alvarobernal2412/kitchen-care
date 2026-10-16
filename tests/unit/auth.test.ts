import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { sessions, users } from '../../src/lib/server/db/schema';
import { AuthError, normalizeUsername, signUp } from '../../src/lib/server/auth/users';
import {
	getSessionUser,
	login,
	logout,
	requireAdmin,
	revokeUserSessions
} from '../../src/lib/server/auth/session';

const PW = 'Abcdef1!';
const DEPT = 'Interactions Research Group';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});

async function rejectsWith(p: Promise<unknown>, code: string) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err).toBeInstanceOf(AuthError);
	expect((err as AuthError).code).toBe(code);
}

describe('normalizeUsername', () => {
	it('trims and lowercases', () => {
		expect(normalizeUsername('  AnA ')).toBe('ana');
	});
});

describe('signUp', () => {
	it('creates a Student, keeping the trimmed display casing and ignoring any department', async () => {
		const u = await signUp(t.db, {
			username: ' Sam.Student ',
			password: PW,
			classification: 'Student',
			department: DEPT
		});
		expect(u.displayUsername).toBe('Sam.Student');
		expect(u.usernameNormalized).toBe('sam.student');
		expect(u.role).toBe('user');
		expect(u.department).toBeNull();
		expect('passwordHash' in u).toBe(false);
	});

	it('creates an Employee with an allowed department', async () => {
		const u = await signUp(t.db, {
			username: 'emp1',
			password: PW,
			classification: 'Employee',
			department: DEPT
		});
		expect(u.classification).toBe('Employee');
		expect(u.department).toBe(DEPT);
	});

	it('stores an argon2id hash, never the plain password', async () => {
		await signUp(t.db, { username: 'hashed', password: PW, classification: 'Student' });
		const [row] = await t.db.select().from(users).where(eq(users.usernameNormalized, 'hashed'));
		expect(row.passwordHash).toMatch(/^\$argon2id\$/);
		expect(row.passwordHash).not.toContain(PW);
	});

	it('rejects an Employee without a department', async () => {
		await rejectsWith(
			signUp(t.db, { username: 'nodept', password: PW, classification: 'Employee' }),
			'department_required'
		);
	});

	it('rejects an Employee with an unknown department', async () => {
		await rejectsWith(
			signUp(t.db, {
				username: 'baddept',
				password: PW,
				classification: 'Employee',
				department: 'Made Up Lab'
			}),
			'department_required'
		);
	});

	it('rejects an unknown classification', async () => {
		await rejectsWith(
			signUp(t.db, {
				username: 'badclass',
				password: PW,
				classification: 'Visitor' as unknown as 'Student'
			}),
			'invalid_classification'
		);
	});

	it('rejects a weak password', async () => {
		await rejectsWith(
			signUp(t.db, { username: 'weak', password: 'abc', classification: 'Student' }),
			'weak_password'
		);
	});

	it.each(['', '   ', 'ab', 'a'.repeat(33), 'has space', 'semi;colon', 'émile'])(
		'rejects invalid username %j',
		async (username) => {
			await rejectsWith(
				signUp(t.db, { username, password: PW, classification: 'Student' }),
				'invalid_username'
			);
		}
	);

	it("rejects a duplicate of 'Ana' when 'ana ' already exists", async () => {
		await signUp(t.db, { username: 'ana ', password: PW, classification: 'Student' });
		await rejectsWith(
			signUp(t.db, { username: 'Ana', password: PW, classification: 'Student' }),
			'username_taken'
		);
	});

	it('reports username_taken (not a crash) when two sign-ups race', async () => {
		const results = await Promise.allSettled([
			signUp(t.db, { username: 'racer', password: PW, classification: 'Student' }),
			signUp(t.db, { username: 'RACER', password: PW, classification: 'Student' })
		]);
		const failed = results.filter((r) => r.status === 'rejected');
		expect(failed).toHaveLength(1);
		expect(((failed[0] as PromiseRejectedResult).reason as AuthError).code).toBe('username_taken');
	});
});

describe('login and sessions', () => {
	it('logs in with any casing of the username and resolves the session user', async () => {
		await signUp(t.db, { username: 'Loggy', password: PW, classification: 'Student' });
		const { sessionId } = await login(t.db, ' LOGGY ', PW);
		const user = await getSessionUser(t.db, sessionId);
		expect(user?.displayUsername).toBe('Loggy');
		expect(user && 'passwordHash' in user).toBe(false);
	});

	it('uses an opaque session id of at least 32 random bytes', async () => {
		await signUp(t.db, { username: 'opaque', password: PW, classification: 'Student' });
		const a = await login(t.db, 'opaque', PW);
		const b = await login(t.db, 'opaque', PW);
		expect(a.sessionId).toMatch(/^[A-Za-z0-9_-]{43,}$/);
		expect(a.sessionId).not.toBe(b.sessionId);
	});

	it('does not store the session id in plain text', async () => {
		await signUp(t.db, { username: 'plain', password: PW, classification: 'Student' });
		const { sessionId } = await login(t.db, 'plain', PW);
		const rows = await t.db.select().from(sessions);
		expect(rows.some((r) => r.id === sessionId)).toBe(false);
		expect(rows.some((r) => r.id.includes(sessionId))).toBe(false);
	});

	it('fails with the same error for a wrong password and an unknown user', async () => {
		await signUp(t.db, { username: 'wrongpw', password: PW, classification: 'Student' });
		const wrong = await login(t.db, 'wrongpw', 'Nope1234!').catch((e) => e);
		const unknown = await login(t.db, 'ghost', PW).catch((e) => e);
		expect(wrong).toBeInstanceOf(AuthError);
		expect(unknown).toBeInstanceOf(AuthError);
		expect(wrong.code).toBe('invalid_credentials');
		expect(unknown.code).toBe('invalid_credentials');
		expect(wrong.message).toBe(unknown.message);
	});

	it('fails for a deactivated user even with the right password', async () => {
		const u = await signUp(t.db, { username: 'deact', password: PW, classification: 'Student' });
		await t.db.update(users).set({ active: false }).where(eq(users.id, u.id));
		await rejectsWith(login(t.db, 'deact', PW), 'invalid_credentials');
	});

	it('stops resolving sessions of a user who is deactivated afterwards', async () => {
		const u = await signUp(t.db, { username: 'later', password: PW, classification: 'Student' });
		const { sessionId } = await login(t.db, 'later', PW);
		await t.db.update(users).set({ active: false }).where(eq(users.id, u.id));
		expect(await getSessionUser(t.db, sessionId)).toBeNull();
	});

	it('returns null from getSessionUser after logout', async () => {
		await signUp(t.db, { username: 'bye', password: PW, classification: 'Student' });
		const { sessionId } = await login(t.db, 'bye', PW);
		expect(await getSessionUser(t.db, sessionId)).not.toBeNull();
		await logout(t.db, sessionId);
		expect(await getSessionUser(t.db, sessionId)).toBeNull();
	});

	it('returns null for expired sessions', async () => {
		await signUp(t.db, { username: 'expired', password: PW, classification: 'Student' });
		const { sessionId } = await login(t.db, 'expired', PW);
		await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
		expect(await getSessionUser(t.db, sessionId)).toBeNull();
	});

	it('returns null for unknown or empty session ids', async () => {
		expect(await getSessionUser(t.db, 'nope')).toBeNull();
		expect(await getSessionUser(t.db, '')).toBeNull();
	});
});

describe('revokeUserSessions', () => {
	it("kills every session of that user and leaves other users' sessions alone", async () => {
		const a = await signUp(t.db, { username: 'revoker', password: PW, classification: 'Student' });
		await signUp(t.db, { username: 'bystander', password: PW, classification: 'Student' });
		const a1 = await login(t.db, 'revoker', PW);
		const a2 = await login(t.db, 'revoker', PW);
		const other = await login(t.db, 'bystander', PW);

		await revokeUserSessions(t.db, a.id);

		expect(await getSessionUser(t.db, a1.sessionId)).toBeNull();
		expect(await getSessionUser(t.db, a2.sessionId)).toBeNull();
		expect(await getSessionUser(t.db, other.sessionId)).not.toBeNull();
	});
});

describe('requireAdmin', () => {
	const base = {
		id: 1,
		usernameNormalized: 'x',
		displayUsername: 'x',
		classification: null,
		department: null,
		avatarPath: null,
		active: true,
		onboardingCompleted: true,
		createdAt: new Date()
	};
	const status = (fn: () => unknown) => {
		try {
			fn();
		} catch (e) {
			return (e as { status?: number }).status;
		}
		return undefined;
	};

	it('returns the user when they are an admin', () => {
		const user = { ...base, role: 'admin' as const };
		expect(requireAdmin({ user })).toBe(user);
	});
	it('throws 403 for a regular user', () => {
		expect(status(() => requireAdmin({ user: { ...base, role: 'user' } }))).toBe(403);
	});
	it('throws 401 for an anonymous visitor', () => {
		expect(status(() => requireAdmin({ user: null }))).toBe(401);
	});
});
