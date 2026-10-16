import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import {
	InactiveUserError,
	InvalidTextError,
	POST_MAX,
	createPost,
	listPosts,
	toFeedPost
} from '$lib/server/feed';
import { parseFeedCursor } from '$lib/server/feedCursor';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 20;
export const load: PageServerLoad = async ({ locals, url }) => {
	const cursor = parseFeedCursor(url.searchParams);
	const page = await listPosts(getDb(), {
		limit: PAGE_SIZE,
		viewerId: locals.user!.id,
		...(cursor ?? {})
	});
	return {
		posts: page.posts.map(toFeedPost),
		next: page.next
			? { before: page.next.before.toISOString(), beforeId: page.next.beforeId }
			: null,
		paged: cursor !== null,
		meId: locals.user!.id,
		postMax: POST_MAX
	};
};

const postSchema = z.object({ body: z.string() });

export const actions: Actions = {
	post: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) return fail(401, { error: 'Sign in required.', body: '' });
		if (!user.active) return fail(403, { error: 'Your account is not active.', body: '' });
		const parsed = postSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Write something first.', body: '' });
		if (!hit(`post:${user.id}`, 5, 60_000)) {
			return fail(429, { error: 'Too many posts. Try again in a minute.', body: parsed.data.body });
		}
		try {
			await createPost(getDb(), user.id, { body: parsed.data.body });
		} catch (err) {
			if (err instanceof InvalidTextError) {
				return fail(400, { error: err.message, body: parsed.data.body });
			}
			if (err instanceof InactiveUserError) {
				return fail(403, { error: 'Your account is not active.', body: parsed.data.body });
			}
			throw err;
		}
		return { posted: true };
	}
};
