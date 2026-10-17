import { fail } from '@sveltejs/kit';
import { z, ZodError } from 'zod';
import { listPeriodActivity } from '$lib/server/activity';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { tasks } from '$lib/server/db/schema';
import { getActivePeriod } from '$lib/server/periods';
import { hit } from '$lib/server/ratelimit';
import {
	NotAdminError,
	NotRevocableError,
	PeriodClosedError,
	REVOKE_REASON_MAX,
	SubmissionNotFoundError,
	revokeSubmission
} from '$lib/server/revoke';
import type { Actions, PageServerLoad } from './$types';

const intId = z.coerce.number().int().positive().max(2_147_483_647);
// Each filter falls back to "no filter" on garbage instead of failing the page.
const filterSchema = z.object({
	task: z.string().trim().min(1).max(64).catch(''),
	user: z.string().trim().max(64).catch(''),
	removed: z.literal('1').optional().catch(undefined),
	beforeId: intId.optional().catch(undefined)
});
const revokeSchema = z.object({
	submissionId: intId,
	reason: z
		.string()
		.trim()
		.min(1, 'Add a reason so the person knows why')
		.max(REVOKE_REASON_MAX, `Reason is too long (${REVOKE_REASON_MAX} characters max)`),
	confirm: z.literal('yes', { error: 'Tick the box to confirm' })
});

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const db = getDb();
	const p = url.searchParams;
	const [taskRows, period] = await Promise.all([
		db.select({ key: tasks.key, label: tasks.label }).from(tasks).orderBy(tasks.label),
		getActivePeriod(db)
	]);
	const parsed = filterSchema.parse({
		task: p.get('task') ?? '',
		user: p.get('user') ?? '',
		removed: p.get('removed') ?? undefined,
		beforeId: p.get('beforeId') ?? undefined
	});
	// An unknown chore is dropped rather than yielding an empty, confusing list.
	const taskKey = taskRows.some((t) => t.key === parsed.task) ? parsed.task : '';
	const includeRemoved = parsed.removed === '1';

	const base = {
		filters: { task: taskKey, user: parsed.user, removed: includeRemoved },
		tasks: taskRows,
		paged: parsed.beforeId !== undefined
	};
	if (!period) return { ...base, period: null, items: [], next: null, nextQuery: '', query: '' };

	const page = await listPeriodActivity(db, period.id, {
		taskKey: taskKey || undefined,
		user: parsed.user || undefined,
		includeRemoved,
		beforeId: parsed.beforeId
	});
	const keep = {
		...(taskKey ? { task: taskKey } : {}),
		...(parsed.user ? { user: parsed.user } : {}),
		...(includeRemoved ? { removed: '1' } : {})
	};
	return {
		...base,
		period: { name: period.name },
		items: page.items.map((i) => ({
			...i,
			createdAt: i.createdAt.toISOString(),
			revokedAt: i.revokedAt?.toISOString() ?? null
		})),
		next: page.next,
		// the filters, to carry through a removal and to the next page
		query: new URLSearchParams(keep).toString(),
		nextQuery:
			page.next === null ? '' : new URLSearchParams({ ...keep, beforeId: String(page.next) }).toString()
	};
};

export const actions: Actions = {
	revoke: async ({ request, locals }) => {
		const admin = requireAdmin(locals); // layout loads do not run for form actions
		const data = Object.fromEntries(await request.formData());
		const parsed = revokeSchema.safeParse(data);
		if (!parsed.success) {
			const id = Number(data.submissionId);
			return fail(400, {
				submissionId: Number.isInteger(id) ? id : undefined,
				error: parsed.error.issues[0].message
			});
		}
		const { submissionId, reason } = parsed.data;
		if (!hit(`admin-revoke:${admin.id}`, 30, 60_000)) {
			return fail(429, { submissionId, error: 'Too many requests. Try again in a minute.' });
		}
		try {
			await revokeSubmission(getDb(), admin.id, submissionId, reason);
		} catch (err) {
			if (err instanceof NotRevocableError) {
				return fail(409, { submissionId, error: 'This chore was already removed or is not approved.' });
			}
			if (err instanceof PeriodClosedError) {
				return fail(409, {
					submissionId,
					error: 'Its period has ended, so the result is final and cannot be changed.'
				});
			}
			if (err instanceof SubmissionNotFoundError) {
				return fail(404, { submissionId, error: 'Submission not found.' });
			}
			if (err instanceof NotAdminError) {
				return fail(403, { submissionId, error: 'Only admins can remove points.' });
			}
			if (err instanceof ZodError) {
				return fail(400, { submissionId, error: 'Add a reason so the person knows why' });
			}
			throw err;
		}
		return { removed: submissionId };
	}
};
