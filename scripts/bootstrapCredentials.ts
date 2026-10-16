import { RULE_LABELS, validatePassword } from '../src/lib/passwordRules';

// Same limits as signup (src/lib/server/auth/users.ts); duplicated so this stays dependency-free.
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;

/**
 * Reads the first admin's credentials from the environment (never argv) and validates them with
 * the same policy as signup. Error messages never include the password.
 */
export function readBootstrapCredentials(env: Record<string, string | undefined>): {
	username: string;
	password: string;
} {
	const username = env.ADMIN_BOOTSTRAP_USERNAME?.trim();
	const password = env.ADMIN_BOOTSTRAP_PASSWORD;
	if (!username) throw new Error('ADMIN_BOOTSTRAP_USERNAME is not set');
	if (!password) throw new Error('ADMIN_BOOTSTRAP_PASSWORD is not set');
	if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
		throw new Error(`Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters`);
	}
	const { ok, missing } = validatePassword(password);
	if (!ok) {
		throw new Error(
			`Password does not meet the policy: ${missing.map((r) => RULE_LABELS[r]).join('; ')}`
		);
	}
	return { username, password };
}
