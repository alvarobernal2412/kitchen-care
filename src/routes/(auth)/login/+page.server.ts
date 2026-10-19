import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { setSessionCookie } from '$lib/server/auth/cookie';
import { login } from '$lib/server/auth/session';
import { AuthError } from '$lib/server/auth/users';
import { getDb } from '$lib/server/db';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const WINDOW_MS = 15 * 60 * 1000;

const schema = z.object({
	username: z.string().trim().min(1, 'Enter your username').max(64),
	password: z.string().min(1, 'Enter your password').max(256)
});

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, '/');
	return { deleted: url.searchParams.get('deleted') === '1' };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = schema.safeParse(data);
		if (!parsed.success) {
			return fail(400, {
				username: typeof data.username === 'string' ? data.username : '',
				error: parsed.error.issues[0].message
			});
		}
		const { username, password } = parsed.data;

		const ip = getClientAddress();
		const allowed =
			hit(`login:ip:${ip}`, 50, WINDOW_MS) &&
			hit(`login:${ip}:${username.toLowerCase()}`, 10, WINDOW_MS);
		if (!allowed) {
			return fail(429, { username, error: 'Too many attempts. Try again in a few minutes.' });
		}

		try {
			const { sessionId } = await login(getDb(), username, password);
			setSessionCookie(cookies, sessionId);
		} catch (err) {
			if (err instanceof AuthError) return fail(400, { username, error: err.message });
			throw err;
		}
		redirect(303, '/');
	}
};
