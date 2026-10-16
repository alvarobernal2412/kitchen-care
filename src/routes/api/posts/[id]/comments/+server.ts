import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { posts } from '$lib/server/db/schema';
import { addComment, listComments, toFeedComment } from '$lib/server/feed';
import { badRequest, guard, mapFeedError, notFound, parseId } from '$lib/server/feedApi';
import type { RequestHandler } from './$types';

const bodySchema = z.object({ body: z.string() });

export const GET: RequestHandler = async ({ locals, params }) => {
	const g = guard(locals, 'comments-read', 120);
	if ('response' in g) return g.response;
	const postId = parseId(params.id);
	if (postId === null) return notFound();

	const db = getDb();
	const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId));
	if (!post) return notFound();
	const list = await listComments(db, postId);
	return json({ comments: list.map(toFeedComment) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const g = guard(locals, 'comment', 10);
	if ('response' in g) return g.response;
	const postId = parseId(params.id);
	if (postId === null) return notFound();
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return badRequest();

	try {
		const c = await addComment(getDb(), g.user.id, postId, body.data.body);
		return json(
			{
				comment: toFeedComment({
					id: c.id,
					postId: c.postId,
					createdAt: c.createdAt,
					body: c.body,
					author: {
						id: g.user.id,
						username: g.user.displayUsername,
						avatar: g.user.avatarPath,
						department: g.user.department,
						classification: g.user.classification,
						deactivated: false
					}
				})
			},
			{ status: 201 }
		);
	} catch (err) {
		return mapFeedError(err);
	}
};
