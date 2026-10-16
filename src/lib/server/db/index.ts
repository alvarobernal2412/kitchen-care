import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** What `db.transaction(async (tx) => ...)` hands you. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** The query surface shared by a `Db` and a `Tx`; accept this to run inside or outside a transaction. */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

export function createDb(url: string): { db: Db; client: postgres.Sql } {
	const client = postgres(url);
	return { db: drizzle(client, { schema }), client };
}

let shared: Db | undefined;

/** Lazily-created app-wide connection from DATABASE_URL. */
export function getDb(): Db {
	if (!shared) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL is not set');
		shared = createDb(url).db;
	}
	return shared;
}
