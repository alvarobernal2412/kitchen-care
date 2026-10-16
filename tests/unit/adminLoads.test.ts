import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({
	getDb: () => {
		throw new Error('db must not be touched for non-admins');
	}
}));

async function statusOf(run: () => unknown): Promise<number | null> {
	try {
		await run();
		return null;
	} catch (e) {
		return (e as { status?: number }).status ?? -1;
	}
}

const cases = [
	['review', () => import('../../src/routes/(admin)/admin/review/+page.server')],
	['periods', () => import('../../src/routes/(admin)/admin/periods/+page.server')]
] as const;

describe('admin page loads', () => {
	for (const [name, mod] of cases) {
		it(`${name}: 403 for a non-admin, 401 for anonymous`, async () => {
			const { load } = await mod();
			const run = (user: unknown) => () =>
				(load as (e: unknown) => unknown)({ locals: { user } });
			expect(await statusOf(run({ id: 1, role: 'user', active: true }))).toBe(403);
			expect(await statusOf(run(null))).toBe(401);
		});
	}
});
