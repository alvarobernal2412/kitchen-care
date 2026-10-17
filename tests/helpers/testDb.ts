import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inject } from 'vitest';
import * as schema from '../../src/lib/server/db/schema';
import type { Db } from '../../src/lib/server/db';
import { newTestDbName, testBaseUrl } from './testDbUrl';

export type TestDb = { db: Db; close: () => Promise<void> };

/**
 * Creates a uniquely named throwaway database next to the configured one and returns a Db.
 * It is a copy of this run's migrated template (built once by tests/globalSetup.ts, which hands
 * the name over with vitest's inject); without that template (a single file run with another
 * config) it falls back to migrating per file.
 * close() ends connections and drops it. If setup fails part-way, the same teardown runs before
 * the error is rethrown. (Generated migrations reference "public".*, so a schema-per-test would
 * not work.)
 */
export async function getTestDb(): Promise<TestDb> {
	const base = testBaseUrl();
	const name = newTestDbName('db');
	const template = inject('kcTestTemplate');
	const testUrl = new URL(base);
	testUrl.pathname = `/${name}`;

	const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
	const client = postgres(testUrl.toString(), { max: 4, onnotice: () => {} });

	const close = async () => {
		await client.end().catch(() => {});
		await admin.unsafe(`drop database if exists "${name}" with (force)`).catch(() => {});
		await admin.end().catch(() => {});
	};

	try {
		if (template) {
			await admin.unsafe(`create database "${name}" template "${template}"`);
			return { db: drizzle(client, { schema }), close };
		}
		console.warn('no template database for this run: migrating a per-file test database instead');
		await admin.unsafe(`create database "${name}"`);
		const db = drizzle(client, { schema });
		await migrate(db, { migrationsFolder: './drizzle' });
		return { db, close };
	} catch (err) {
		await close();
		throw err;
	}
}
