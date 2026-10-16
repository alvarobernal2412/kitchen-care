import { z } from 'zod';

const CURSOR_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

const cursorSchema = z.object({
	before: z.iso
		.datetime()
		.transform((s) => new Date(s))
		.refine((d) => d.getTime() >= 0 && d.getTime() <= Date.now() + CURSOR_FUTURE_SLACK_MS),
	beforeId: z.coerce.number().int().positive().max(2_147_483_647).optional()
});

/** Validates the `before`/`beforeId` query params; garbage yields null (caller shows page one). */
export function parseFeedCursor(params: URLSearchParams): { before: Date; beforeId?: number } | null {
	const r = cursorSchema.safeParse({
		before: params.get('before'),
		beforeId: params.get('beforeId') ?? undefined
	});
	return r.success ? r.data : null;
}
