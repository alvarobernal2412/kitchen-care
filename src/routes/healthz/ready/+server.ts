import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** Readiness: 200 only if the database answers. Used by the container HEALTHCHECK. */
export const GET: RequestHandler = async () => {
	try {
		await getDb().execute(sql`select 1`);
		return json({ ok: true });
	} catch {
		// No error details: this path is public.
		return json({ ok: false }, { status: 503 });
	}
};
