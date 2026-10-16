import { createHash, randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import type { Db, Executor } from '../db';
import { sessions, users } from '../db/schema';
import { hashPassword, verifyPassword } from './hash';
import { AuthError, normalizeUsername, toUser, type User } from './users';

export const SESSION_COOKIE = 'kc_session';
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Only this digest is stored; a DB leak therefore does not yield usable session ids. */
function hashSessionId(sessionId: string): string {
	return createHash('sha256').update(sessionId).digest('hex');
}

// Verified against when the username is unknown, so both failure paths cost one argon2 verify.
let dummyHash: Promise<string> | undefined;

const INVALID = () => new AuthError('invalid_credentials', 'Invalid username or password.');

async function createSession(db: Db, userId: number): Promise<string> {
	const sessionId = randomBytes(32).toString('base64url');
	await db.insert(sessions).values({
		id: hashSessionId(sessionId),
		userId,
		expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
	});
	return sessionId;
}

export async function login(
	db: Db,
	username: string,
	password: string
): Promise<{ sessionId: string }> {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.usernameNormalized, normalizeUsername(username)));
	if (!row) {
		dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
		await verifyPassword(await dummyHash, password);
		throw INVALID();
	}
	const ok = await verifyPassword(row.passwordHash, password);
	if (!ok || !row.active) throw INVALID();
	return { sessionId: await createSession(db, row.id) };
}

export async function getSessionUser(db: Db, sessionId: string): Promise<User | null> {
	if (!sessionId) return null;
	const [row] = await db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(
			and(
				eq(sessions.id, hashSessionId(sessionId)),
				gt(sessions.expiresAt, new Date()),
				eq(users.active, true)
			)
		);
	return row ? toUser(row.user) : null;
}

export async function logout(db: Db, sessionId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, hashSessionId(sessionId)));
}

/** Kills every session of a user (deactivation, password reset). */
export async function revokeUserSessions(db: Executor, userId: number): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function requireAdmin(locals: { user: User | null }): User {
	if (!locals.user) error(401, 'Sign in required');
	if (locals.user.role !== 'admin') error(403, 'Admins only');
	return locals.user;
}
