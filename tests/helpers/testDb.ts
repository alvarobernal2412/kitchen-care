import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import type { Db } from '../../src/lib/server/db';

export type TestDb = { db: Db; close: () => Promise<void> };

/**
 * Creates a uniquely named throwaway database next to the configured one, runs the
 * drizzle migrations in it, and returns a Db. close() ends connections and drops it.
 * (Generated migrations reference "public".*, so a schema-per-test would not work.)
 */
export async function getTestDb(): Promise<TestDb> {
	const base = new URL(
		process.env.TEST_DATABASE_URL ??
			process.env.DATABASE_URL ??
			'postgres://kitchen:kitchen@localhost:5432/kitchen' // compose.dev.yml default
	);
	const name = `kc_test_${randomBytes(6).toString('hex')}`;

	const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
	await admin.unsafe(`create database "${name}"`);

	const testUrl = new URL(base);
	testUrl.pathname = `/${name}`;
	const client = postgres(testUrl.toString(), { max: 4, onnotice: () => {} });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });

	return {
		db,
		close: async () => {
			await client.end();
			await admin.unsafe(`drop database "${name}" with (force)`);
			await admin.end();
		}
	};
}
