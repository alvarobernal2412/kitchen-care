import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { deleteOwnComment } from '$lib/server/feed';
import { guard, mapFeedError, notFound, parseId } from '$lib/server/feedApi';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const g = guard(locals, 'delete', 30);
	if ('response' in g) return g.response;
	const commentId = parseId(params.id);
	if (commentId === null) return notFound();
	try {
		await deleteOwnComment(getDb(), g.user.id, commentId);
		return json({ ok: true });
	} catch (err) {
		return mapFeedError(err);
	}
};
