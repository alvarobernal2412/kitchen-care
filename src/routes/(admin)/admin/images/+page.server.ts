import { fail } from '@sveltejs/kit';
import { ne } from 'drizzle-orm';
import { z } from 'zod';
import { PeriodNotEndedError, deletePeriodImages, listProofImages } from '$lib/server/admin';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { tasks } from '$lib/server/db/schema';
import { getActivePeriod, listPastPeriods } from '$lib/server/periods';
import { hit } from '$lib/server/ratelimit';
import { WELCOME_BONUS_KEY } from '$lib/server/welcomeBonus';
import type { Actions, PageServerLoad } from './$types';

const intId = z.coerce.number().int().positive().max(2_147_483_647);
// Each filter falls back to "no filter" on garbage instead of failing the page.
const filterSchema = z.object({
	task: z.string().trim().min(1).max(64).catch(''),
	user: z.string().trim().max(64).catch(''),
	period: intId.optional().catch(undefined),
	beforeId: intId.optional().catch(undefined)
});
const deleteSchema = z.object({
	periodId: intId,
	confirm: z.literal('yes', { error: 'Tick the box to confirm' })
});

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const db = getDb();
	const p = url.searchParams;
	const [taskRows, active, past] = await Promise.all([
		db
			.select({ key: tasks.key, label: tasks.label })
			.from(tasks)
			.where(ne(tasks.key, WELCOME_BONUS_KEY)) // the bonus has no photo
			.orderBy(tasks.label),
		getActivePeriod(db),
		listPastPeriods(db)
	]);
	const periodOptions = [
		...(active ? [{ id: active.id, name: active.name, active: true }] : []),
		...past.map((x) => ({ id: x.id, name: x.name, active: false }))
	];

	const parsed = filterSchema.parse({
		task: p.get('task') ?? '',
		user: p.get('user') ?? '',
		period: p.get('period') ?? undefined,
		beforeId: p.get('beforeId') ?? undefined
	});
	// Unknown task/period values are dropped rather than yielding an empty, confusing list.
	const taskKey = taskRows.some((t) => t.key === parsed.task) ? parsed.task : '';
	const periodId = periodOptions.some((x) => x.id === parsed.period) ? parsed.period : undefined;

	const page = await listProofImages(db, {
		taskKey: taskKey || undefined,
		user: parsed.user || undefined,
		periodId,
		beforeId: parsed.beforeId
	});
	return {
		filters: { task: taskKey, user: parsed.user, period: periodId ?? null },
		tasks: taskRows,
		periods: periodOptions,
		items: page.items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
		nextQuery:
			page.next === null
				? ''
				: new URLSearchParams({
						...(taskKey ? { task: taskKey } : {}),
						...(parsed.user ? { user: parsed.user } : {}),
						...(periodId !== undefined ? { period: String(periodId) } : {}),
						beforeId: String(page.next)
					}).toString(),
		next: page.next,
		paged: parsed.beforeId !== undefined
	};
};

export const actions: Actions = {
	deleteImages: async ({ request, locals }) => {
		const admin = requireAdmin(locals); // layout loads do not run for form actions
		const data = Object.fromEntries(await request.formData());
		const parsed = deleteSchema.safeParse(data);
		if (!parsed.success) {
			const id = Number(data.periodId);
			return fail(400, {
				periodId: Number.isInteger(id) ? id : undefined,
				error: parsed.error.issues[0].message
			});
		}
		const { periodId } = parsed.data;
		if (!hit(`admin-images:${admin.id}`, 5, 60_000)) {
			return fail(429, { periodId, error: 'Too many requests. Try again in a minute.' });
		}
		try {
			const res = await deletePeriodImages(getDb(), periodId);
			return { periodId, removed: res.removed, failed: res.failed };
		} catch (err) {
			if (err instanceof PeriodNotEndedError) {
				return fail(409, {
					periodId,
					error: 'Proof images can only be deleted after the period has ended.'
				});
			}
			throw err;
		}
	}
};
