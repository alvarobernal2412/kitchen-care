import { DEPARTMENTS, users } from '../db/schema';
import type { Db } from '../db';
import { hashPassword } from './hash';
import { validatePassword } from './password';
import { grantWelcomeBonus, isWelcomeBonusOpen } from '../welcomeBonus';

/** A user row without the password hash; safe to put in `locals` and pass around. */
export type User = Omit<typeof users.$inferSelect, 'passwordHash'>;

export type AuthErrorCode =
	| 'invalid_username'
	| 'weak_password'
	| 'invalid_classification'
	| 'department_required'
	| 'username_taken'
	| 'invalid_credentials'
	| 'wrong_password';

export class AuthError extends Error {
	constructor(
		public readonly code: AuthErrorCode,
		message: string
	) {
		super(message);
		this.name = 'AuthError';
	}
}

export type SignUpInput = {
	username: string;
	password: string;
	classification: 'Student' | 'Employee';
	department?: string | null;
};

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

export function normalizeUsername(s: string): string {
	return s.trim().toLowerCase();
}

/** The username is already used by another account (case-insensitively). */
export class UsernameTakenError extends AuthError {
	constructor() {
		super('username_taken', 'That username is taken.');
		this.name = 'UsernameTakenError';
	}
}

/** Trims and checks a username; returns the display form and the unique lookup key. */
export function parseUsername(raw: string): { display: string; normalized: string } {
	const normalized = normalizeUsername(raw);
	if (normalized.length < USERNAME_MIN || normalized.length > USERNAME_MAX || !USERNAME_RE.test(normalized)) {
		throw new AuthError(
			'invalid_username',
			`Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters: letters, digits, ".", "_" or "-".`
		);
	}
	return { display: raw.trim(), normalized };
}

/** Strips the password hash from a full users row. */
export function toUser(row: typeof users.$inferSelect): User {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { passwordHash, ...user } = row;
	return user;
}

export function isUniqueViolation(err: unknown): boolean {
	for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
		if (e.code === '23505') return true;
	}
	return false;
}

/**
 * Creates an account. Before the welcome-bonus deadline (see welcomeBonus.ts) the new user also
 * gets the one-time bonus when a period is active, in the same transaction as the user row.
 */
export async function signUp(
	db: Db,
	input: SignUpInput,
	opts: { now?: Date } = {}
): Promise<User> {
	const now = opts.now ?? new Date();
	const { display, normalized } = parseUsername(input.username);
	if (input.classification !== 'Student' && input.classification !== 'Employee') {
		throw new AuthError('invalid_classification', 'Choose Student or Employee.');
	}
	let department: (typeof DEPARTMENTS)[number] | null = null;
	if (input.classification === 'Employee') {
		department = DEPARTMENTS.find((d) => d === input.department) ?? null;
		if (!department) throw new AuthError('department_required', 'Employees must pick a department.');
	}
	if (!validatePassword(input.password).ok) {
		throw new AuthError('weak_password', 'Password does not meet the policy.');
	}

	const passwordHash = await hashPassword(input.password);
	try {
		const row = await db.transaction(async (tx) => {
			const [created] = await tx
				.insert(users)
				.values({
					usernameNormalized: normalized,
					displayUsername: display,
					passwordHash,
					classification: input.classification,
					department
				})
				.returning();
			if (isWelcomeBonusOpen(now)) await grantWelcomeBonus(tx, created.id, now);
			return created;
		});
		return toUser(row);
	} catch (err) {
		// The unique index on username_normalized is the source of truth, including for races.
		if (isUniqueViolation(err)) throw new UsernameTakenError();
		throw err;
	}
}
