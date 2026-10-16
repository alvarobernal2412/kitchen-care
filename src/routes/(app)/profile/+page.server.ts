import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { changePassword } from '$lib/server/auth/account';
import { SESSION_COOKIE } from '$lib/server/auth/session';
import { AuthError } from '$lib/server/auth/users';
import { getDb } from '$lib/server/db';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	currentPassword: z.string().min(1, 'Enter your current password').max(256),
	newPassword: z.string().max(256),
	confirmPassword: z.string().max(256)
});

export const load: PageServerLoad = ({ locals }) => {
	const u = locals.user!; // guaranteed by the (app) layout and the global guard
	return {
		profile: {
			username: u.displayUsername,
			classification: u.classification,
			department: u.department,
			avatarPath: u.avatarPath
		}
	};
};

export const actions: Actions = {
	password: async ({ request, locals, cookies }) => {
		const user = locals.user;
		const sessionId = cookies.get(SESSION_COOKIE);
		if (!user || !sessionId) return fail(401, { error: 'Sign in required' });
		if (!hit(`pwchange:${user.id}`, 5, 15 * 60 * 1000)) {
			return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });
		}
		const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const { currentPassword, newPassword, confirmPassword } = parsed.data;
		if (newPassword !== confirmPassword) return fail(400, { error: 'The new passwords do not match.' });
		try {
			await changePassword(getDb(), user.id, currentPassword, newPassword, sessionId);
		} catch (err) {
			if (err instanceof AuthError) return fail(400, { error: err.message });
			throw err;
		}
		return { passwordChanged: true };
	}
};
