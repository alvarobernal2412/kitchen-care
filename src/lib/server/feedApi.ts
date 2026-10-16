import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { User } from './auth/users';
import {
	CommentNotFoundError,
	InactiveUserError,
	InvalidEmojiError,
	InvalidTextError,
	NotAuthorError,
	PostNotFoundError
} from './feed';
import { hit } from './ratelimit';

export const idSchema = z.coerce.number().int().positive().max(2_147_483_647);

/** Login (401) + active (403) + rate limit (429). Returns the user or an error response. */
export function guard(
	locals: { user: User | null },
	bucket: string,
	limit: number
): { user: User } | { response: Response } {
	const user = locals.user;
	if (!user) return { response: json({ error: 'unauthorized' }, { status: 401 }) };
	if (!user.active) return { response: json({ error: 'forbidden' }, { status: 403 }) };
	if (!hit(`${bucket}:${user.id}`, limit, 60_000)) {
		return { response: json({ error: 'rate_limited' }, { status: 429 }) };
	}
	return { user };
}

export function parseId(raw: string): number | null {
	const r = idSchema.safeParse(raw);
	return r.success ? r.data : null;
}

export const notFound = () => json({ error: 'not_found' }, { status: 404 });
export const badRequest = () => json({ error: 'bad_request' }, { status: 400 });

export function mapFeedError(err: unknown): Response {
	if (err instanceof InactiveUserError) return json({ error: 'forbidden' }, { status: 403 });
	if (err instanceof NotAuthorError) return json({ error: 'forbidden' }, { status: 403 });
	if (err instanceof PostNotFoundError || err instanceof CommentNotFoundError) return notFound();
	if (err instanceof InvalidEmojiError) return json({ error: 'invalid_emoji' }, { status: 400 });
	if (err instanceof InvalidTextError) {
		return json({ error: 'invalid_text', message: err.message }, { status: 422 });
	}
	throw err;
}
