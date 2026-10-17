import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { isStaleTestDb, newTestDbName, testBaseUrl } from './helpers/testDbUrl';

declare module 'vitest' {
	interface ProvidedContext {
		/** Name of this run's migrated template database; absent when global setup did not run. */
		kcTestTemplate?: string;
	}
}

/**
 * Drops test databases left behind by killed runs: stale by the creation time in their name and
 * with no open connection. A concurrent run's databases are young, so they are never touched.
 */
async function dropStaleDatabases(admin: postgres.Sql): Promise<void> {
	const rows = await admin<{ datname: string }[]>`
		select datname from pg_database
		where datname like 'kc\_test\_%'
		and not exists (select 1 from pg_stat_activity where datname = pg_database.datname)`;
	for (const { datname } of rows) {
		if (!isStaleTestDb(datname)) continue;
		await admin.unsafe(`drop database if exists "${datname}" with (force)`).catch(() => {});
	}
}

/**
 * Creates and migrates ONE template database per run (named uniquely, so overlapping runs on one
 * Postgres do not collide), so each test file only copies it (CREATE DATABASE ... TEMPLATE) instead
 * of replaying every migration. The name reaches the workers through vitest's provide/inject. All
 * connections are closed before the tests start, as Postgres refuses to copy a template in use.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	const base = testBaseUrl();
	const template = newTestDbName('template');
	const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
	try {
		await dropStaleDatabases(admin).catch(() => {});
		await admin.unsafe(`create database "${template}"`);
		const url = new URL(base);
		url.pathname = `/${template}`;
		const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
		try {
			await migrate(drizzle(client), { migrationsFolder: './drizzle' });
		} finally {
			await client.end();
		}
	} catch (err) {
		await admin.unsafe(`drop database if exists "${template}" with (force)`).catch(() => {});
		await admin.end().catch(() => {});
		throw err;
	}
	await admin.end();
	project.provide('kcTestTemplate', template);

	return async () => {
		const a = postgres(base.toString(), { max: 1, onnotice: () => {} });
		try {
			await a.unsafe(`drop database if exists "${template}" with (force)`);
		} finally {
			await a.end();
		}
	};
}
