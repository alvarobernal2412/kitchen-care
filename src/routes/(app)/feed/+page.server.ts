import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import {
	InactiveUserError,
	InvalidTextError,
	POST_MAX,
	TITLE_MAX,
	checkPostFields,
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
		postMax: POST_MAX,
		titleMax: TITLE_MAX
	};
};

const postSchema = z.object({ title: z.string().default(''), body: z.string().default('') });

export const actions: Actions = {
	post: async ({ request, locals }) => {
		const user = locals.user;
		const empty = { title: '', body: '' };
		if (!user) return fail(401, { error: 'Sign in required.', ...empty });
		if (!user.active) return fail(403, { error: 'Your account is not active.', ...empty });
		const parsed = postSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { titleError: 'Add a title.', bodyError: 'Write something first.', ...empty });
		}
		const { title, body } = parsed.data;
		// Both fields are checked together so the form can show every problem at once.
		const problems = checkPostFields({ title, body });
		if (problems.title || problems.body) {
			return fail(400, { titleError: problems.title, bodyError: problems.body, title, body });
		}
		if (!hit(`post:${user.id}`, 5, 60_000)) {
			return fail(429, { error: 'Too many posts. Try again in a minute.', title, body });
		}
		try {
			await createPost(getDb(), user.id, { title, body });
		} catch (err) {
			if (err instanceof InvalidTextError) return fail(400, { error: err.message, title, body });
			if (err instanceof InactiveUserError) {
				return fail(403, { error: 'Your account is not active.', title, body });
			}
			throw err;
		}
		return { posted: true };
	}
};
