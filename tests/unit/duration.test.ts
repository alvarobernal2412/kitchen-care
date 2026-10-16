import { describe, expect, it } from 'vitest';
import { formatRemaining } from '../../src/lib/duration';

describe('formatRemaining', () => {
	it('formats hours, minutes and seconds', () => {
		expect(formatRemaining(45)).toBe('45s');
		expect(formatRemaining(60)).toBe('1m');
		expect(formatRemaining(8040)).toBe('2h 14m');
		expect(formatRemaining(7200)).toBe('2h');
		expect(formatRemaining(8041)).toBe('2h 15m');
	});
});
