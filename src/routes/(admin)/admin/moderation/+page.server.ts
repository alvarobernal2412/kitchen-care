import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import {
	CommentNotFoundError,
	PostNotFoundError,
	listComments,
	listPosts,
	toFeedComment,
	toFeedPost
} from '$lib/server/feed';
import { parseFeedCursor } from '$lib/server/feedCursor';
import { adminDeleteComment, adminDeletePost } from '$lib/server/moderation';
import { NotAdminError } from '$lib/server/review';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 20;
const idSchema = z.coerce.number().int().positive().max(2_147_483_647);
const deleteSchema = z.object({ id: idSchema, confirm: z.literal('yes', { error: 'Tick the box to confirm' }) });

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const db = getDb();
	const cursor = parseFeedCursor(url.searchParams);
	const page = await listPosts(db, { limit: PAGE_SIZE, ...(cursor ?? {}) });
	const withComments = await Promise.all(
		page.posts.map(async (p) => ({
			...toFeedPost(p),
			comments: p.commentCount > 0 ? (await listComments(db, p.id)).map(toFeedComment) : []
		}))
	);
	return {
		posts: withComments,
		next: page.next
			? { before: page.next.before.toISOString(), beforeId: page.next.beforeId }
			: null,
		paged: cursor !== null
	};
};

function deleteError(err: unknown, kind: 'post' | 'comment', id: number) {
	if (err instanceof PostNotFoundError || err instanceof CommentNotFoundError) {
		return fail(404, { kind, id, error: `That ${kind} no longer exists.` });
	}
	if (err instanceof NotAdminError) return fail(403, { kind, id, error: 'Admins only.' });
	throw err;
}

async function run(
	kind: 'post' | 'comment',
	{ request, locals }: { request: Request; locals: App.Locals }
) {
	const admin = requireAdmin(locals); // layout loads do not run for form actions
	const data = Object.fromEntries(await request.formData());
	const parsed = deleteSchema.safeParse(data);
	if (!parsed.success) {
		const id = Number(data.id);
		return fail(400, {
			kind,
			id: Number.isInteger(id) ? id : undefined,
			error: parsed.error.issues[0].message
		});
	}
	const { id } = parsed.data;
	if (!hit(`admin-mod:${admin.id}`, 30, 60_000)) {
		return fail(429, { kind, id, error: 'Too many deletions. Try again in a minute.' });
	}
	try {
		if (kind === 'post') await adminDeletePost(getDb(), admin.id, id);
		else await adminDeleteComment(getDb(), admin.id, id);
	} catch (err) {
		return deleteError(err, kind, id);
	}
	return { kind, id, deleted: true };
}

export const actions: Actions = {
	deletePost: (event) => run('post', event),
	deleteComment: (event) => run('comment', event)
};
