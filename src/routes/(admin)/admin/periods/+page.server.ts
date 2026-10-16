import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import {
	ActivePeriodExistsError,
	PeriodNotActiveError,
	createPeriod,
	endPeriod,
	getActivePeriod,
	listPastPeriods
} from '$lib/server/periods';
import { getLeaderboard } from '$lib/server/leaderboard';
import type { Actions, PageServerLoad } from './$types';

const createSchema = z.object({
	name: z.string().trim().min(1, 'Enter a period name').max(80, 'Name is too long')
});
const endSchema = z.object({
	periodId: z.coerce.number().int().positive(),
	confirm: z.literal('yes', { error: 'Tick the box to confirm ending the period' })
});

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals); // layout loads are skipped on client-side navigation
	const db = getDb();
	const [active, past] = await Promise.all([getActivePeriod(db), listPastPeriods(db)]);
	const standings = active ? await getLeaderboard(db, active.id) : [];
	return {
		active: active
			? {
					id: active.id,
					name: active.name,
					startsAt: active.startsAt.toISOString(),
					participants: standings.length
				}
			: null,
		past: past.map((p) => ({
			id: p.id,
			name: p.name,
			startsAt: p.startsAt.toISOString(),
			endsAt: p.endsAt?.toISOString() ?? null,
			participants: p.participants,
			winners: p.winners
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireAdmin(locals); // layout loads do not run for form actions
		const data = Object.fromEntries(await request.formData());
		const parsed = createSchema.safeParse(data);
		if (!parsed.success) {
			return fail(400, {
				action: 'create',
				name: typeof data.name === 'string' ? data.name : '',
				error: parsed.error.issues[0].message
			});
		}
		try {
			await createPeriod(getDb(), parsed.data.name);
		} catch (err) {
			if (err instanceof ActivePeriodExistsError) {
				return fail(409, {
					action: 'create',
					name: parsed.data.name,
					error: 'A period is already active. End it before starting a new one.'
				});
			}
			throw err;
		}
		return { action: 'create', created: parsed.data.name };
	},
	end: async ({ request, locals }) => {
		requireAdmin(locals);
		const parsed = endSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { action: 'end', error: parsed.error.issues[0].message });
		}
		try {
			const winners = await endPeriod(getDb(), parsed.data.periodId);
			return { action: 'end', winnerCount: winners.length };
		} catch (err) {
			if (err instanceof PeriodNotActiveError) {
				return fail(409, { action: 'end', error: 'That period is not active.' });
			}
			throw err;
		}
	}
};
