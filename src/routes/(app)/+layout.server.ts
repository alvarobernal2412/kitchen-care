import { redirect } from '@sveltejs/kit';
import { needsOnboarding } from '$lib/onboarding';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	if (needsOnboarding(locals.user, url.pathname)) redirect(303, '/onboarding');
	return { user: locals.user };
};
