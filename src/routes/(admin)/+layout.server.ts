import { redirect } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { submissions } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const user = requireAdmin(locals); // 403 for signed-in non-admins
	const [{ count }] = await getDb()
		.select({ count: sql<number>`count(*)::int` })
		.from(submissions)
		.where(eq(submissions.status, 'pending'));
	return { user, pendingCount: count };
};
