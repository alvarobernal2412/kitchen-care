import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { changePassword, changeUsername } from '$lib/server/auth/account';
import { SESSION_COOKIE } from '$lib/server/auth/session';
import { AuthError } from '$lib/server/auth/users';
import { getDb } from '$lib/server/db';
import { InactiveUserError } from '$lib/server/tasks';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	currentPassword: z.string().min(1, 'Enter your current password').max(256),
	newPassword: z.string().max(256),
	confirmPassword: z.string().max(256)
});

const usernameSchema = z.object({
	username: z.string().trim().min(1, 'Enter a username.').max(100, 'That username is too long.'),
	currentPassword: z.string().min(1, 'Enter your current password.').max(256)
});

export const load: PageServerLoad = ({ locals, url }) => {
	const u = locals.user!; // guaranteed by the (app) layout and the global guard
	return {
		renamed: url.searchParams.get('renamed') === '1',
		profile: {
			username: u.displayUsername,
			classification: u.classification,
			department: u.department,
			avatarPath: u.avatarPath
		}
	};
};

export const actions: Actions = {
	username: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) return fail(401, { usernameError: 'Sign in required', usernameField: null });
		const raw = Object.fromEntries(await request.formData());
		// Echo the typed name back so a failed submit keeps it; never the password.
		const typed = typeof raw.username === 'string' ? raw.username : '';
		if (!hit(`unchange:${user.id}`, 5, 60 * 60 * 1000)) {
			return fail(429, {
				usernameError: 'Too many attempts. Try again in a few minutes.',
				usernameField: null,
				username: typed
			});
		}
		const parsed = usernameSchema.safeParse(raw);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return fail(400, {
				usernameError: issue.message,
				usernameField: issue.path[0] === 'currentPassword' ? 'password' : 'username',
				username: typed
			});
		}
		try {
			await changeUsername(getDb(), user.id, parsed.data.currentPassword, parsed.data.username);
		} catch (err) {
			if (err instanceof AuthError) {
				return fail(err.code === 'username_taken' ? 409 : 400, {
					usernameError: err.message,
					usernameField: err.code === 'wrong_password' ? 'password' : 'username',
					username: typed
				});
			}
			if (err instanceof InactiveUserError) {
				return fail(403, { usernameError: 'Your account is not active.', usernameField: null, username: typed });
			}
			throw err;
		}
		// locals.user was loaded before this action ran, so a redirect makes the next request see the new name.
		redirect(303, '/profile?renamed=1');
	},
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
