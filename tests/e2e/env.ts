import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Shared by playwright.config.ts, global-setup.ts and the helpers.
export const E2E_PORT = 4179;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DB_NAME = 'kitchen_e2e';
export const E2E_UPLOAD_DIR = join(tmpdir(), 'kcc-e2e-uploads');
export const ADMIN_USERNAME = 'e2eadmin';
export const ADMIN_PASSWORD = 'E2e-Admin-Pass1!';
export const TEST_PASSWORD = 'E2e-Pass-word1!';

/** Admin connection string (the compose.dev.yml database), from DATABASE_URL when set. */
export function adminDatabaseUrl(): string {
	return process.env.DATABASE_URL ?? 'postgres://kitchen:kitchen@localhost:5432/kitchen';
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Global setup drops and recreates a database, so refuse to run against anything but this machine. */
export function assertLocalDatabase(): void {
	const { hostname } = new URL(adminDatabaseUrl());
	if (!LOCAL_HOSTS.has(hostname)) {
		throw new Error(
			`Refusing to run e2e setup: DATABASE_URL host "${hostname}" is not local. ` +
				'The e2e run drops and recreates the "kitchen_e2e" database; use localhost, 127.0.0.1 or ::1.'
		);
	}
	if (E2E_DB_NAME !== 'kitchen_e2e') throw new Error('Unexpected e2e database name');
}

/** Connection string of the dedicated e2e database; never the dev or unit-test databases. */
export function e2eDatabaseUrl(): string {
	const url = new URL(adminDatabaseUrl());
	url.pathname = `/${E2E_DB_NAME}`;
	return url.toString();
}
