import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hit, resetRateLimits } from '../../src/lib/server/ratelimit';

describe('rate limiter', () => {
	beforeEach(() => {
		resetRateLimits();
		vi.useFakeTimers();
	});
	afterEach(() => vi.useRealTimers());

	it('allows up to the limit and then blocks', () => {
		expect([hit('a', 3, 1000), hit('a', 3, 1000), hit('a', 3, 1000)]).toEqual([true, true, true]);
		expect(hit('a', 3, 1000)).toBe(false);
	});

	it('tracks keys independently', () => {
		hit('a', 1, 1000);
		expect(hit('a', 1, 1000)).toBe(false);
		expect(hit('b', 1, 1000)).toBe(true);
	});

	it('allows again once the window has passed', () => {
		hit('a', 1, 1000);
		expect(hit('a', 1, 1000)).toBe(false);
		vi.advanceTimersByTime(1001);
		expect(hit('a', 1, 1000)).toBe(true);
	});

	it('does not count blocked attempts against the window', () => {
		hit('a', 1, 1000);
		vi.advanceTimersByTime(600);
		hit('a', 1, 1000); // blocked
		vi.advanceTimersByTime(500); // first hit is now 1100ms old
		expect(hit('a', 1, 1000)).toBe(true);
	});

	it('resetRateLimits clears all state', () => {
		hit('a', 1, 1000);
		resetRateLimits();
		expect(hit('a', 1, 1000)).toBe(true);
	});
});
