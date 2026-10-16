import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { deleteOwnPost } from '$lib/server/feed';
import { guard, mapFeedError, notFound, parseId } from '$lib/server/feedApi';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const g = guard(locals, 'delete', 30);
	if ('response' in g) return g.response;
	const postId = parseId(params.id);
	if (postId === null) return notFound();
	try {
		await deleteOwnPost(getDb(), g.user.id, postId);
		return json({ ok: true });
	} catch (err) {
		return mapFeedError(err);
	}
};
