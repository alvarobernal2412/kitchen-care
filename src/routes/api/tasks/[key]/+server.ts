import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { hit } from '$lib/server/ratelimit';
import { getActivePeriod } from '$lib/server/periods';
import {
	CooldownError,
	InactiveUserError,
	NoActivePeriodError,
	TaskRequiresReviewError,
	UnknownTaskError,
	getUserPeriodTotal,
	logTask
} from '$lib/server/tasks';
import type { RequestHandler } from './$types';

const keySchema = z.string().regex(/^[a-z_]{1,32}$/);

export const POST: RequestHandler = async ({ locals, params }) => {
	const user = locals.user;
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });

	const key = keySchema.safeParse(params.key);
	if (!key.success) return json({ error: 'unknown_task' }, { status: 404 });

	if (!hit(`task:${user.id}`, 30, 60_000)) {
		return json({ error: 'rate_limited' }, { status: 429 });
	}

	const db = getDb();
	try {
		const submission = await logTask(db, user.id, key.data);
		const period = await getActivePeriod(db);
		const newTotal = period ? await getUserPeriodTotal(db, user.id, period.id) : undefined;
		return json({ ok: true, pointsAwarded: submission.pointsAwarded, newTotal });
	} catch (err) {
		if (err instanceof CooldownError) {
			return json(
				{ error: 'cooldown', retryAfterSeconds: err.retryAfterSeconds },
				{ status: 409 }
			);
		}
		if (err instanceof NoActivePeriodError) {
			return json({ error: 'no_active_period' }, { status: 409 });
		}
		if (err instanceof UnknownTaskError) return json({ error: 'unknown_task' }, { status: 404 });
		if (err instanceof TaskRequiresReviewError) {
			return json({ error: 'requires_review' }, { status: 422 });
		}
		if (err instanceof InactiveUserError) return json({ error: 'forbidden' }, { status: 403 });
		throw err;
	}
};
