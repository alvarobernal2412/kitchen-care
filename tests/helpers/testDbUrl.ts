import { randomBytes } from 'node:crypto';

/** The configured Postgres (compose.dev.yml default), shared by the global setup and getTestDb(). */
export function testBaseUrl(): URL {
	return new URL(
		process.env.TEST_DATABASE_URL ??
			process.env.DATABASE_URL ??
			'postgres://kitchen:kitchen@localhost:5432/kitchen'
	);
}

/** Only names matching this are ever dropped by the stale-database cleanup. */
export const TEST_DB_NAME = /^(?:kc_test_template|kc_test_(?:template_)?[0-9a-f]+)$/;

/** Runs older than this are assumed killed; their leftover databases may be dropped. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

const STAMP_DIGITS = 11; // Date.now() in hex, fixed width
const RANDOM_DIGITS = 8;

/**
 * `kc_test_template_<creation time><random>` or `kc_test_<creation time><random>`, all hex. The
 * creation time lets a later run tell a leftover from a database a concurrent run is still using.
 */
export function newTestDbName(kind: 'template' | 'db', now = Date.now()): string {
	const stamp = now.toString(16).padStart(STAMP_DIGITS, '0');
	const rand = randomBytes(RANDOM_DIGITS / 2).toString('hex');
	return `kc_test_${kind === 'template' ? 'template_' : ''}${stamp}${rand}`;
}

/** Creation time embedded in a name by newTestDbName(); null for names from before that existed. */
export function createdAtOf(name: string): number | null {
	const m = /^kc_test_(?:template_)?([0-9a-f]+)$/.exec(name);
	if (!m || m[1].length !== STAMP_DIGITS + RANDOM_DIGITS) return null;
	return parseInt(m[1].slice(0, STAMP_DIGITS), 16);
}

/** True for a database the cleanup may drop (the caller also requires it to have no connections). */
export function isStaleTestDb(name: string, now = Date.now()): boolean {
	if (!TEST_DB_NAME.test(name)) return false;
	const created = createdAtOf(name);
	return created === null || now - created > STALE_AFTER_MS;
}
