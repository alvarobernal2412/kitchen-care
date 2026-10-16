import { describe, expect, it } from 'vitest';
import { shortAgo, timeAgo } from '../../src/lib/relativeTime';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('shortAgo', () => {
	it('formats compact activity times', () => {
		expect(shortAgo(ago(5_000), NOW)).toBe('now');
		expect(shortAgo(ago(12 * 60_000), NOW)).toBe('12 min');
		expect(shortAgo(ago(90 * 60_000), NOW)).toBe('1 h');
		expect(shortAgo(ago(3 * 86_400_000), NOW)).toBe('3 d');
		expect(shortAgo(ago(-60_000), NOW)).toBe('now');
	});
});

describe('timeAgo', () => {
	it('formats recent times', () => {
		expect(timeAgo(ago(5_000), NOW)).toBe('just now');
		expect(timeAgo(ago(5 * 60_000), NOW)).toBe('5m ago');
		expect(timeAgo(ago(2 * 3_600_000), NOW)).toBe('2h ago');
		expect(timeAgo(ago(3 * 86_400_000), NOW)).toBe('3d ago');
	});
	it('never goes negative for clock skew', () => {
		expect(timeAgo(ago(-60_000), NOW)).toBe('just now');
	});
});
