import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEMPLATE_NAME, testBaseUrl } from './helpers/testDbUrl';

/**
 * Creates and migrates ONE template database per run, so each test file only copies it
 * (CREATE DATABASE ... TEMPLATE) instead of replaying every migration. All connections are
 * closed before the tests start, as Postgres refuses to copy a template that is in use.
 */
export default async function setup(): Promise<() => Promise<void>> {
	const base = testBaseUrl();
	const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
	try {
		// Left over from an aborted run.
		await admin.unsafe(`drop database if exists "${TEMPLATE_NAME}" with (force)`);
		await admin.unsafe(`create database "${TEMPLATE_NAME}"`);
		const url = new URL(base);
		url.pathname = `/${TEMPLATE_NAME}`;
		const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
		try {
			await migrate(drizzle(client), { migrationsFolder: './drizzle' });
		} finally {
			await client.end();
		}
	} catch (err) {
		await admin.unsafe(`drop database if exists "${TEMPLATE_NAME}" with (force)`).catch(() => {});
		await admin.end().catch(() => {});
		throw err;
	}
	await admin.end();

	return async () => {
		const a = postgres(base.toString(), { max: 1, onnotice: () => {} });
		try {
			await a.unsafe(`drop database if exists "${TEMPLATE_NAME}" with (force)`);
		} finally {
			await a.end();
		}
	};
}
