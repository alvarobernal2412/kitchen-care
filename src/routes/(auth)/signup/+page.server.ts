import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { setSessionCookie } from '$lib/server/auth/cookie';
import { login } from '$lib/server/auth/session';
import { AuthError, signUp } from '$lib/server/auth/users';
import { getDb } from '$lib/server/db';
import { DEPARTMENTS } from '$lib/server/db/schema';
import { WELCOME_BONUS_POINTS, welcomeBonusOffer } from '$lib/server/welcomeBonus';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	username: z.string().trim().min(1, 'Choose a username').max(64),
	password: z.string().max(256),
	classification: z.enum(['Student', 'Employee'], { error: 'Choose Student or Employee' }),
	department: z.string().optional()
});

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	// Only a flag, a date and the amount reach the page: nothing about the period itself.
	const offer = await welcomeBonusOffer(getDb(), new Date());
	return {
		departments: [...DEPARTMENTS],
		welcomeBonus: { open: offer.open, untilLabel: offer.untilLabel, points: WELCOME_BONUS_POINTS }
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const data = Object.fromEntries(await request.formData());
		const values = {
			username: typeof data.username === 'string' ? data.username : '',
			classification: typeof data.classification === 'string' ? data.classification : '',
			department: typeof data.department === 'string' ? data.department : ''
		};

		if (!hit(`signup:${getClientAddress()}`, 20, 60 * 60 * 1000)) {
			return fail(429, { ...values, error: 'Too many sign-ups from this address. Try again later.' });
		}

		const parsed = schema.safeParse(data);
		if (!parsed.success) return fail(400, { ...values, error: parsed.error.issues[0].message });

		const db = getDb();
		try {
			await signUp(db, parsed.data as Parameters<typeof signUp>[1]);
			const { sessionId } = await login(db, parsed.data.username, parsed.data.password);
			setSessionCookie(cookies, sessionId);
		} catch (err) {
			if (err instanceof AuthError) return fail(400, { ...values, error: err.message });
			throw err;
		}
		redirect(303, '/');
	}
};
