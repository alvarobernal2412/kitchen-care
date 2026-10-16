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

/** Connection string of the dedicated e2e database; never the dev or unit-test databases. */
export function e2eDatabaseUrl(): string {
	const url = new URL(adminDatabaseUrl());
	url.pathname = `/${E2E_DB_NAME}`;
	return url.toString();
}
