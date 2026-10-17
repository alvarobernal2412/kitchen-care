import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import type { Db } from '../../src/lib/server/db';
import { TEMPLATE_NAME, testBaseUrl } from './testDbUrl';

export type TestDb = { db: Db; close: () => Promise<void> };

/**
 * Creates a uniquely named throwaway database next to the configured one and returns a Db.
 * It is a copy of the migrated template that tests/globalSetup.ts builds once per run; without
 * that template (a single file run with another config) it falls back to migrating per file.
 * close() ends connections and drops it. If setup fails part-way, the same teardown runs before
 * the error is rethrown. (Generated migrations reference "public".*, so a schema-per-test would
 * not work.)
 */
export async function getTestDb(): Promise<TestDb> {
	const base = testBaseUrl();
	const name = `kc_test_${randomBytes(6).toString('hex')}`;
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
		const [tpl] = await admin`select 1 as one from pg_database where datname = ${TEMPLATE_NAME}`;
		if (tpl) {
			await admin.unsafe(`create database "${name}" template "${TEMPLATE_NAME}"`);
			return { db: drizzle(client, { schema }), close };
		}
		console.warn(`${TEMPLATE_NAME} not found: migrating a per-file test database instead`);
		await admin.unsafe(`create database "${name}"`);
		const db = drizzle(client, { schema });
		await migrate(db, { migrationsFolder: './drizzle' });
		return { db, close };
	} catch (err) {
		await close();
		throw err;
	}
}
