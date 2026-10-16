import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { InvalidImageError, MAX_INPUT_BYTES } from '$lib/server/images';
import { hit } from '$lib/server/ratelimit';
import {
	CooldownError,
	DetectionFailedError,
	InactiveUserError,
	NoActivePeriodError,
	NotAReviewTaskError,
	TooManyPendingError,
	UnknownTaskError,
	getUserPeriodTotal,
	submitCutleryTask,
	submitPhotoTask
} from '$lib/server/tasks';
import type { RequestHandler } from './$types';

const keySchema = z.string().regex(/^[a-z_]{1,32}$/);
const cutlerySchema = z.object({ taskKey: z.literal('cutlery'), detected: z.boolean() });
// Allow multipart framing overhead on top of the image limit.
const MAX_BODY_BYTES = MAX_INPUT_BYTES + 64 * 1024;

function mapError(err: unknown): Response {
	if (err instanceof CooldownError) {
		return json({ error: 'cooldown', retryAfterSeconds: err.retryAfterSeconds }, { status: 409 });
	}
	if (err instanceof NoActivePeriodError) return json({ error: 'no_active_period' }, { status: 409 });
	if (err instanceof TooManyPendingError) return json({ error: 'too_many_pending' }, { status: 409 });
	if (err instanceof InvalidImageError) return json({ error: 'invalid_image' }, { status: 422 });
	if (err instanceof NotAReviewTaskError) {
		return json({ error: 'not_a_review_task' }, { status: 422 });
	}
	if (err instanceof DetectionFailedError) {
		return json({ error: 'detection_failed' }, { status: 422 });
	}
	if (err instanceof UnknownTaskError) return json({ error: 'unknown_task' }, { status: 404 });
	if (err instanceof InactiveUserError) return json({ error: 'forbidden' }, { status: 403 });
	throw err;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });
	if (!user.active) return json({ error: 'forbidden' }, { status: 403 });
	if (!hit(`submit:${user.id}`, 10, 60_000)) {
		return json({ error: 'rate_limited' }, { status: 429 });
	}

	const type = request.headers.get('content-type') ?? '';
	const db = getDb();

	try {
		if (type.startsWith('multipart/form-data')) {
			// Refuse before buffering when the declared size is too big; the image size is
			// checked again below for requests without a Content-Length.
			const length = Number(request.headers.get('content-length') ?? 0);
			if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
				return json({ error: 'too_large' }, { status: 413 });
			}
			let form: FormData;
			try {
				form = await request.formData();
			} catch {
				return json({ error: 'bad_request' }, { status: 400 });
			}
			const key = keySchema.safeParse(form.get('taskKey'));
			const image = form.get('image');
			if (!key.success || !(image instanceof File)) {
				return json({ error: 'bad_request' }, { status: 400 });
			}
			if (image.size > MAX_INPUT_BYTES) return json({ error: 'too_large' }, { status: 413 });
			await submitPhotoTask(db, user.id, key.data, Buffer.from(await image.arrayBuffer()));
			return json({ ok: true, status: 'pending' }, { status: 201 });
		}

		if (type.startsWith('application/json')) {
			const body = cutlerySchema.safeParse(await request.json().catch(() => null));
			if (!body.success) return json({ error: 'bad_request' }, { status: 400 });
			const submission = await submitCutleryTask(db, user.id, body.data.detected);
			const newTotal = submission.periodId
				? await getUserPeriodTotal(db, user.id, submission.periodId)
				: undefined;
			return json({ ok: true, pointsAwarded: submission.pointsAwarded, newTotal });
		}

		return json({ error: 'unsupported_media_type' }, { status: 415 });
	} catch (err) {
		return mapError(err);
	}
};
