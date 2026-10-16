import { getDb } from '$lib/server/db';
import { listPastPeriods } from '$lib/server/periods';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const past = await listPastPeriods(getDb());
	return {
		periods: past.map((p) => ({
			id: p.id,
			name: p.name,
			startsAt: p.startsAt.toISOString(),
			endsAt: p.endsAt?.toISOString() ?? null,
			participants: p.participants,
			winners: p.winners
		}))
	};
};
