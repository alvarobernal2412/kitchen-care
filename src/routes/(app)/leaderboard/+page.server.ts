import { getDb } from '$lib/server/db';
import { DEPARTMENTS } from '$lib/server/db/schema';
import { getLeaderboard, type LeaderboardFilter } from '$lib/server/leaderboard';
import { getActivePeriod } from '$lib/server/periods';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const db = getDb();
	const group = url.searchParams.get('group') === 'students'
		? 'students'
		: url.searchParams.get('group') === 'employees'
			? 'employees'
			: 'all';
	const requestedDept = url.searchParams.get('dept');
	const dept =
		group === 'employees' && DEPARTMENTS.includes(requestedDept as (typeof DEPARTMENTS)[number])
			? requestedDept!
			: '';

	const filter: LeaderboardFilter = {};
	if (group === 'students') filter.classification = 'Student';
	if (group === 'employees') {
		filter.classification = 'Employee';
		if (dept) filter.department = dept;
	}

	const period = await getActivePeriod(db);
	const rows = period ? await getLeaderboard(db, period.id, filter) : [];
	return {
		period: period ? { name: period.name } : null,
		rows,
		group,
		dept,
		departments: [...DEPARTMENTS],
		meId: locals.user!.id
	};
};
