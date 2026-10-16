import { describe, expect, it } from 'vitest';
import { GET } from '../../src/routes/healthz/+server';

describe('GET /healthz', () => {
	it('returns 200 with { ok: true }', async () => {
		const res = await GET({} as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
