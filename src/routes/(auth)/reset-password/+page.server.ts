import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { consumeResetToken, ResetError } from '$lib/server/auth/reset';
import { AuthError } from '$lib/server/auth/users';
import { getDb } from '$lib/server/db';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const INVALID_LINK = 'This reset link is invalid or expired. Ask an admin for a new one.';

const schema = z
	.object({
		token: z.string().regex(TOKEN_RE),
		password: z.string().max(256),
		confirm: z.string().max(256)
	})
	.refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

// Only the shape is checked here; validity is decided (generically) when the form is submitted.
export const load: PageServerLoad = ({ url }) => {
	const token = url.searchParams.get('token') ?? '';
	return { token: TOKEN_RE.test(token) ? token : null };
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		if (!hit(`reset:${getClientAddress()}`, 10, 15 * 60 * 1000)) {
			return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });
		}

		const data = Object.fromEntries(await request.formData());
		const parsed = schema.safeParse(data);
		if (!parsed.success) {
			const tokenBad = parsed.error.issues.some((i) => i.path[0] === 'token');
			return fail(400, { error: tokenBad ? INVALID_LINK : parsed.error.issues[0].message });
		}

		try {
			await consumeResetToken(getDb(), parsed.data.token, parsed.data.password);
		} catch (err) {
			if (err instanceof ResetError) return fail(400, { error: INVALID_LINK });
			if (err instanceof AuthError) return fail(400, { error: err.message });
			throw err;
		}
		redirect(303, '/login');
	}
};
