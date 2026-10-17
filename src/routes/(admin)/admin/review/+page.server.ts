import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { onMilestonePost } from '$lib/server/feed';
import {
	AlreadyReviewedError,
	PeriodClosedError,
	REJECT_REASON_MAX,
	SubmissionNotFoundError,
	approve,
	listPending,
	reject
} from '$lib/server/review';
import type { Actions, PageServerLoad } from './$types';

const REASONS = [
	'Photo unclear',
	'Not the requested task',
	'Already logged',
	'Looks like an old photo',
	'Other'
] as const;

const approveSchema = z.object({ submissionId: z.coerce.number().int().positive() });
const rejectSchema = z.object({
	submissionId: z.coerce.number().int().positive(),
	reason: z.enum(REASONS, { error: 'Pick a reason' }),
	note: z.string().trim().max(150, 'Note is too long (150 characters max)').default('')
});

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const pending = await listPending(getDb());
	return {
		reasons: [...REASONS],
		pending: pending.map((p) => ({
			id: p.id,
			taskLabel: p.taskLabel,
			username: p.username,
			avatarPath: p.avatarPath,
			points: p.points,
			imagePath: p.imagePath,
			createdAt: p.createdAt.toISOString()
		}))
	};
};

function reviewError(err: unknown, submissionId: number) {
	if (err instanceof AlreadyReviewedError) {
		return fail(409, { submissionId, error: 'This submission was already reviewed.' });
	}
	if (err instanceof PeriodClosedError) {
		return fail(409, {
			submissionId,
			error: 'Its period has ended, so it cannot be approved. Reject it instead.'
		});
	}
	if (err instanceof SubmissionNotFoundError) {
		return fail(404, { submissionId, error: 'Submission not found.' });
	}
	throw err;
}

export const actions: Actions = {
	approve: async ({ request, locals }) => {
		const admin = requireAdmin(locals); // layout loads do not run for form actions
		const parsed = approveSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid submission.' });
		try {
			await approve(getDb(), admin.id, parsed.data.submissionId, {
				onMilestone: onMilestonePost
			});
		} catch (err) {
			return reviewError(err, parsed.data.submissionId);
		}
		return { approved: parsed.data.submissionId };
	},
	reject: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const data = Object.fromEntries(await request.formData());
		const parsed = rejectSchema.safeParse(data);
		if (!parsed.success) {
			const id = Number(data.submissionId);
			return fail(400, {
				submissionId: Number.isInteger(id) ? id : undefined,
				error: parsed.error.issues[0].message
			});
		}
		const { submissionId, reason, note } = parsed.data;
		const combined = note ? `${reason}: ${note}` : reason;
		if (combined.length > REJECT_REASON_MAX) {
			return fail(400, { submissionId, error: 'Reason is too long.' });
		}
		try {
			await reject(getDb(), admin.id, submissionId, combined);
		} catch (err) {
			return reviewError(err, submissionId);
		}
		return { rejected: submissionId };
	}
};
