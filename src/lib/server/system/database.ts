import { sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';

export type DatabaseInfo =
	| { reachable: false }
	| {
			reachable: true;
			sizeBytes: number;
			tables: { name: string; totalBytes: number; rowEstimate: number }[];
			connections: number;
			maxConnections: number;
			/** Round trip of `select 1`, measured in Node. */
			responseMs: number;
	  };

const n = (v: unknown): number => {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
};

/**
 * Health of the Postgres database. Any failure (closed client, server down, permission) is an
 * "unreachable" result rather than an exception, and no driver message is passed on.
 */
export async function collectDatabase(db: Db): Promise<DatabaseInfo> {
	try {
		const t0 = performance.now();
		await db.execute(sql`select 1`);
		const responseMs = performance.now() - t0;

		const [stats] = await db.execute(sql`
			select
				pg_database_size(current_database())::float8 as size_bytes,
				(select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
				current_setting('max_connections')::int as max_connections
		`);
		// reltuples is -1 for a table never analysed (PostgreSQL 14+): clamp at 0.
		const tables = await db.execute(sql`
			select c.relname as name,
				pg_total_relation_size(c.oid)::float8 as total_bytes,
				greatest(c.reltuples, 0)::float8 as row_estimate
			from pg_class c
			join pg_namespace ns on ns.oid = c.relnamespace
			where c.relkind = 'r' and ns.nspname = 'public'
			order by pg_total_relation_size(c.oid) desc, c.relname
			limit 5
		`);
		return {
			reachable: true,
			sizeBytes: n(stats.size_bytes),
			tables: tables.map((r) => ({
				name: String(r.name),
				totalBytes: n(r.total_bytes),
				rowEstimate: Math.max(0, Math.round(n(r.row_estimate)))
			})),
			connections: n(stats.connections),
			maxConnections: n(stats.max_connections),
			responseMs
		};
	} catch {
		return { reachable: false };
	}
}
