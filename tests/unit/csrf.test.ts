import { describe, expect, it } from 'vitest';
import { isForbiddenApiMutation } from '../../src/lib/server/csrf';

const url = (path: string) => new URL(`https://kitchen.example${path}`);
const req = (method: string, origin?: string) =>
	new Request('https://kitchen.example/x', {
		method,
		headers: origin ? { origin } : {}
	});

describe('isForbiddenApiMutation', () => {
	it('blocks a cross-origin JSON mutation under /api', () => {
		expect(isForbiddenApiMutation(req('POST', 'https://evil.example'), url('/api/tasks'))).toBe(true);
	});
	it('blocks a mutation under /api that has no Origin header', () => {
		expect(isForbiddenApiMutation(req('DELETE'), url('/api/tasks/1'))).toBe(true);
	});
	it('allows a same-origin mutation under /api', () => {
		expect(isForbiddenApiMutation(req('POST', 'https://kitchen.example'), url('/api/tasks'))).toBe(false);
	});
	it('ignores safe methods', () => {
		expect(isForbiddenApiMutation(req('GET', 'https://evil.example'), url('/api/tasks'))).toBe(false);
	});
	it('ignores paths outside /api (SvelteKit checks form posts itself)', () => {
		expect(isForbiddenApiMutation(req('POST', 'https://evil.example'), url('/login'))).toBe(false);
	});
	it('does not treat /apiary as /api', () => {
		expect(isForbiddenApiMutation(req('POST', 'https://evil.example'), url('/apiary'))).toBe(false);
	});
});
