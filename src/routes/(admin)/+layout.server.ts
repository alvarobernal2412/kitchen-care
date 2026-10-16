import { redirect } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { NAV_COOKIE, parseNavCookie } from '$lib/nav';
import { needsOnboarding } from '$lib/onboarding';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { submissions } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) redirect(303, '/login');
	const user = requireAdmin(locals); // 403 for signed-in non-admins
	if (needsOnboarding(user, url.pathname)) redirect(303, '/onboarding');
	const [{ count }] = await getDb()
		.select({ count: sql<number>`count(*)::int` })
		.from(submissions)
		.where(eq(submissions.status, 'pending'));
	return { user, pendingCount: count, nav: parseNavCookie(cookies.get(NAV_COOKIE)) };
};
