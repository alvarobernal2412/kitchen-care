import { describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
vi.mock('../../src/lib/server/db', () => ({ getDb: () => ({ execute }) }));

import { GET } from '../../src/routes/healthz/ready/+server';

describe('GET /healthz/ready', () => {
	it('returns 200 when the database answers', async () => {
		execute.mockResolvedValueOnce([]);
		const res = await GET({} as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('returns 503 without leaking the error when the database is down', async () => {
		execute.mockRejectedValueOnce(new Error('password authentication failed for user "x"'));
		const res = await GET({} as Parameters<typeof GET>[0]);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false });
	});
});
