import { dev } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { NAV_COOKIE, NAV_COOKIE_MAX_AGE, safeReturnPath } from '$lib/nav';
import type { RequestHandler } from './$types';

const Body = z.object({ state: z.enum(['collapsed', 'expanded']) });

/** Stores the sidebar state. Works as a plain form POST (303 back) and as a fetch (204). */
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const form = await request.formData().catch(() => null);
	const parsed = Body.safeParse({ state: form?.get('state') });
	if (!parsed.success) error(400, 'Invalid sidebar state');

	cookies.set(NAV_COOKIE, parsed.data.state, {
		path: '/',
		sameSite: 'lax',
		httpOnly: false, // read by the server on the next render; nothing sensitive
		secure: !dev,
		maxAge: NAV_COOKIE_MAX_AGE
	});

	if (request.headers.get('accept')?.includes('application/json')) {
		return new Response(null, { status: 204 });
	}
	redirect(303, safeReturnPath(request.headers.get('referer'), url.origin));
};
