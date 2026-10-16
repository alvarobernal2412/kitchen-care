import { z } from 'zod';
import {
	MAX_DAY_SPAN_DAYS,
	getActivity,
	getAppTimezone,
	getHeatmap,
	getRangeTotals,
	getTaskDistribution,
	getTopContributors
} from '$lib/server/analytics';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { getActivePeriod, listPastPeriods } from '$lib/server/periods';
import type { PageServerLoad } from './$types';

const DAY_MS = 86_400_000;
const intId = z.coerce.number().int().positive().max(2_147_483_647);
// Every param falls back to its default on garbage instead of failing the page.
const querySchema = z.object({
	range: z.enum(['7d', '30d', 'period']).catch('30d'),
	bucket: z.enum(['day', 'week']).catch('day'),
	periodId: intId.optional().catch(undefined)
});

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const db = getDb();
	const p = url.searchParams;
	const q = querySchema.parse({
		range: p.get('range') ?? undefined,
		bucket: p.get('bucket') ?? undefined,
		periodId: p.get('periodId') ?? undefined
	});

	const [active, past] = await Promise.all([getActivePeriod(db), listPastPeriods(db)]);
	const periodOptions = [
		...(active ? [{ id: active.id, name: active.name, active: true }] : []),
		...past.map((x) => ({ id: x.id, name: x.name, active: false }))
	];

	const now = new Date();
	let range = q.range;
	let from = new Date(now.getTime() - (range === '7d' ? 7 : 30) * DAY_MS);
	if (range === 'period') {
		if (active && active.startsAt < now) from = active.startsAt;
		else range = '30d'; // no active period: fall back to the last 30 days
	}
	// Day buckets are capped; a very long period is trimmed to its most recent stretch.
	const maxSpanMs = (q.bucket === 'day' ? MAX_DAY_SPAN_DAYS : 1830) * DAY_MS;
	if (now.getTime() - from.getTime() > maxSpanMs) from = new Date(now.getTime() - maxSpanMs);

	const tz = getAppTimezone();
	const periodId =
		periodOptions.find((x) => x.id === q.periodId)?.id ?? active?.id ?? null;
	const span = { from, to: now, tz };

	const [totals, activity, heatmap, contributors, distribution] = await Promise.all([
		getRangeTotals(db, span),
		getActivity(db, { ...span, bucket: q.bucket }),
		getHeatmap(db, span),
		periodId === null ? [] : getTopContributors(db, periodId),
		periodId === null ? [] : getTaskDistribution(db, periodId)
	]);

	return {
		query: { range, bucket: q.bucket },
		tz,
		from: from.toISOString(),
		to: now.toISOString(),
		periodNote: q.range === 'period' && range !== 'period',
		totals,
		activity,
		heatmap,
		periodId,
		periods: periodOptions,
		contributors,
		distribution
	};
};
