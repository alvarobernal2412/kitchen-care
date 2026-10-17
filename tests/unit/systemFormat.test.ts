import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatMs, formatPercent } from '../../src/lib/systemFormat';

describe('formatBytes', () => {
	it('uses bytes below 1 KB and switches at the boundary', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1023)).toBe('1023 B');
		expect(formatBytes(1024)).toBe('1.0 KB');
	});
	it('shows one decimal for larger units', () => {
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
		expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
		expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
	});
	it('treats negatives as 0 B and non-numbers as n/a', () => {
		expect(formatBytes(-5)).toBe('0 B');
		expect(formatBytes(Number.NaN)).toBe('n/a');
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('n/a');
	});
});

describe('formatPercent', () => {
	it('rounds, with one decimal below 10', () => {
		expect(formatPercent(8)).toBe('8%');
		expect(formatPercent(8.24)).toBe('8.2%');
		expect(formatPercent(45.6)).toBe('46%');
		expect(formatPercent(0)).toBe('0%');
	});
	it('clamps negatives and handles NaN', () => {
		expect(formatPercent(-3)).toBe('0%');
		expect(formatPercent(Number.NaN)).toBe('n/a');
	});
});

describe('formatDuration', () => {
	it('picks readable units', () => {
		expect(formatDuration(0)).toBe('0 s');
		expect(formatDuration(45)).toBe('45 s');
		expect(formatDuration(300)).toBe('5 min');
		expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
		expect(formatDuration(2 * 86400 + 4 * 3600)).toBe('2 d 4 h');
	});
	it('handles bad input', () => {
		expect(formatDuration(-1)).toBe('0 s');
		expect(formatDuration(Number.NaN)).toBe('n/a');
	});
});

describe('formatMs', () => {
	it('shows ms, then seconds', () => {
		expect(formatMs(12.4)).toBe('12 ms');
		expect(formatMs(999)).toBe('999 ms');
		expect(formatMs(1200)).toBe('1.2 s');
		expect(formatMs(Number.NaN)).toBe('n/a');
		expect(formatMs(-1)).toBe('0 ms');
	});
});
