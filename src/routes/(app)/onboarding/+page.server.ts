import { redirect } from '@sveltejs/kit';
import { asc, ne } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { tasks } from '$lib/server/db/schema';
import { completeOnboarding } from '$lib/server/onboarding';
import { WELCOME_BONUS_KEY } from '$lib/server/welcomeBonus';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await getDb()
		.select({
			key: tasks.key,
			label: tasks.label,
			points: tasks.points,
			requiresPhoto: tasks.requiresPhoto,
			needsReview: tasks.needsReview
		})
		.from(tasks)
		.where(ne(tasks.key, WELCOME_BONUS_KEY))
		.orderBy(asc(tasks.points), asc(tasks.key));
	return { tasks: rows };
};

export const actions: Actions = {
	// Both "Get started" and "Skip" post here.
	default: async ({ locals }) => {
		if (!locals.user) redirect(303, '/login');
		await completeOnboarding(getDb(), locals.user.id);
		redirect(303, '/');
	}
};
