import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { isEmoji, toggleReaction } from '$lib/server/feed';
import { badRequest, guard, mapFeedError, notFound, parseId } from '$lib/server/feedApi';
import type { RequestHandler } from './$types';

const bodySchema = z.object({ emoji: z.string().refine(isEmoji) });

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const g = guard(locals, 'react', 60);
	if ('response' in g) return g.response;
	const postId = parseId(params.id);
	if (postId === null) return notFound();
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success || !isEmoji(body.data.emoji)) return badRequest();

	try {
		const result = await toggleReaction(getDb(), g.user.id, postId, body.data.emoji);
		return json(result);
	} catch (err) {
		return mapFeedError(err);
	}
};
