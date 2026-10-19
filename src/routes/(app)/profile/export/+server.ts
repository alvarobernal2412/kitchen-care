import { error } from '@sveltejs/kit';
import { exportUserData } from '$lib/server/dataExport';
import { getDb } from '$lib/server/db';
import { hit } from '$lib/server/ratelimit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Sign in required');
	if (!hit(`export:${user.id}`, 5, 60_000)) error(429, 'Too many requests');
	const data = await exportUserData(getDb(), user.id);
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': 'attachment; filename="kitchen-care-my-data.json"',
			'Cache-Control': 'no-store'
		}
	});
};
