import { redirect } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { NAV_COOKIE, parseNavCookie } from '$lib/nav';
import { needsOnboarding } from '$lib/onboarding';
import { getDb } from '$lib/server/db';
import { submissions } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) redirect(303, '/login');
	if (needsOnboarding(locals.user, url.pathname)) redirect(303, '/onboarding');
	// Admins see the pending-review count next to Admin > Review in the sidebar.
	let pendingCount = 0;
	if (locals.user.role === 'admin') {
		const [row] = await getDb()
			.select({ count: sql<number>`count(*)::int` })
			.from(submissions)
			.where(eq(submissions.status, 'pending'));
		pendingCount = row.count;
	}
	return { user: locals.user, nav: parseNavCookie(cookies.get(NAV_COOKIE)), pendingCount };
};
