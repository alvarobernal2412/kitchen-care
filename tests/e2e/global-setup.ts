import { mkdir, rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import { bootstrapAdmin, seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import {
	ADMIN_PASSWORD,
	ADMIN_USERNAME,
	E2E_DB_NAME,
	E2E_UPLOAD_DIR,
	adminDatabaseUrl,
	assertLocalDatabase,
	e2eDatabaseUrl
} from './env';

/** Drops and recreates the dedicated e2e database, then migrates and seeds it. */
export default async function globalSetup(): Promise<void> {
	assertLocalDatabase();
	const admin = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => {} });
	try {
		await admin.unsafe(`drop database if exists "${E2E_DB_NAME}" with (force)`);
		await admin.unsafe(`create database "${E2E_DB_NAME}"`);
	} finally {
		await admin.end();
	}

	const client = postgres(e2eDatabaseUrl(), { max: 1, onnotice: () => {} });
	try {
		const db = drizzle(client, { schema });
		await migrate(db, { migrationsFolder: './drizzle' });
		await seedTasks(db);
		await bootstrapAdmin(db, ADMIN_USERNAME, ADMIN_PASSWORD);
		await createPeriod(db, 'E2E period');
	} finally {
		await client.end();
	}

	await rm(E2E_UPLOAD_DIR, { recursive: true, force: true });
	await mkdir(E2E_UPLOAD_DIR, { recursive: true });
}
