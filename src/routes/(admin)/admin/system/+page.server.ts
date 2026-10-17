import { getAppTimezone } from '$lib/server/analytics';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { collectSystem } from '$lib/server/system/collect';
import type { PageServerLoad } from './$types';

/** Seconds between automatic refreshes when the admin switches auto-refresh on. */
const REFRESH_SECONDS = 30;

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const snapshot = await collectSystem({ getDb });
	const tz = getAppTimezone();
	// Formatted here, once, so the server render and the hydrated page show the same text.
	const updatedAt = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZone: tz
	}).format(new Date(snapshot.generatedAt));
	return { snapshot, updatedAt, refreshSeconds: REFRESH_SECONDS };
};
