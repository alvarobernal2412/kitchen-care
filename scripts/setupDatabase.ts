import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import { seedTasks } from '../src/lib/server/db/seed';

/** Connects to DATABASE_URL; the caller must end() the client. */
export function connect() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const client = postgres(url, { max: 1, onnotice: () => {} });
	return { client, db: drizzle(client, { schema }) };
}

/** Applies pending migrations and seeds missing tasks. Idempotent. */
export async function prepareDatabase(db: ReturnType<typeof connect>['db']): Promise<void> {
	await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? './drizzle' });
	await seedTasks(db);
}
