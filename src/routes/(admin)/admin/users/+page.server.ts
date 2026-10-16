import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	LastAdminError,
	NotAdminError,
	SelfChangeError,
	UserNotFoundError,
	searchUsers,
	setActive,
	setRole
} from '$lib/server/admin';
import { ResetError, buildResetUrl, createResetToken } from '$lib/server/auth/reset';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { hit } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

const qSchema = z.string().trim().max(64).catch('');
const idSchema = z.coerce.number().int().positive().max(2_147_483_647);
const confirm = z.literal('yes', { error: 'Tick the box to confirm' });
const roleSchema = z.object({ userId: idSchema, role: z.enum(['user', 'admin']), confirm });
const activeSchema = z.object({ userId: idSchema, active: z.enum(['true', 'false']) });
const resetSchema = z.object({ userId: idSchema });

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const q = qSchema.parse(url.searchParams.get('q') ?? '');
	const rows = await searchUsers(getDb(), q);
	return {
		q,
		meId: locals.user!.id,
		users: rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))
	};
};

function userError(err: unknown, userId: number) {
	if (err instanceof SelfChangeError) {
		return fail(409, { userId, error: 'You cannot demote or deactivate yourself.' });
	}
	if (err instanceof LastAdminError) {
		return fail(409, { userId, error: 'The last active admin cannot be demoted or deactivated.' });
	}
	if (err instanceof UserNotFoundError) return fail(404, { userId, error: 'User not found.' });
	if (err instanceof NotAdminError) return fail(403, { userId, error: 'Admins only.' });
	if (err instanceof ResetError) {
		return err.code === 'user_not_found'
			? fail(404, { userId, error: 'User not found.' })
			: fail(403, { userId, error: 'Admins only.' });
	}
	throw err;
}

function invalid(data: Record<string, unknown>, error: string) {
	const id = Number(data.userId);
	return fail(400, { userId: Number.isInteger(id) ? id : undefined, error });
}

const limited = (userId: number) =>
	fail(429, { userId, error: 'Too many changes. Try again in a minute.' });

export const actions: Actions = {
	role: async ({ request, locals }) => {
		const admin = requireAdmin(locals); // layout loads do not run for form actions
		const data = Object.fromEntries(await request.formData());
		const parsed = roleSchema.safeParse(data);
		if (!parsed.success) return invalid(data, parsed.error.issues[0].message);
		if (!hit(`admin-user:${admin.id}`, 30, 60_000)) return limited(parsed.data.userId);
		try {
			await setRole(getDb(), admin.id, parsed.data.userId, parsed.data.role);
		} catch (err) {
			return userError(err, parsed.data.userId);
		}
		return { userId: parsed.data.userId, done: parsed.data.role === 'admin' ? 'Made admin.' : 'Admin removed.' };
	},
	active: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const data = Object.fromEntries(await request.formData());
		const parsed = activeSchema.safeParse(data);
		if (!parsed.success) return invalid(data, 'Invalid request.');
		const active = parsed.data.active === 'true';
		// Deactivation needs the explicit second step; reactivation is harmless.
		if (!active && data.confirm !== 'yes') {
			return fail(400, { userId: parsed.data.userId, error: 'Tick the box to confirm' });
		}
		if (!hit(`admin-user:${admin.id}`, 30, 60_000)) return limited(parsed.data.userId);
		try {
			await setActive(getDb(), admin.id, parsed.data.userId, active);
		} catch (err) {
			return userError(err, parsed.data.userId);
		}
		return { userId: parsed.data.userId, done: active ? 'Reactivated.' : 'Deactivated.' };
	},
	reset: async ({ request, locals, url }) => {
		const admin = requireAdmin(locals);
		const data = Object.fromEntries(await request.formData());
		const parsed = resetSchema.safeParse(data);
		if (!parsed.success) return invalid(data, 'Invalid request.');
		if (!hit(`admin-reset:${admin.id}`, 10, 60_000)) return limited(parsed.data.userId);
		try {
			const token = await createResetToken(getDb(), admin.id, parsed.data.userId);
			// Only in this action result: never in load data, never logged or stored.
			return { userId: parsed.data.userId, resetUrl: buildResetUrl(url.origin, token) };
		} catch (err) {
			return userError(err, parsed.data.userId);
		}
	}
};
