import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/session';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: requireAdmin(locals) }; // 403 for signed-in non-admins
};
