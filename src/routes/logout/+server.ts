import { redirect } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/server/auth/cookie';
import { SESSION_COOKIE, logout } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (sessionId) await logout(getDb(), sessionId);
	clearSessionCookie(cookies);
	redirect(303, '/login');
};
