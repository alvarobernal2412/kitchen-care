import { describe, expect, it } from 'vitest';
import { hasCutlery } from '../../src/lib/client/cutlery';

describe('hasCutlery', () => {
	it('is true for a confident fork', () => {
		expect(hasCutlery([{ class: 'fork', score: 0.9 }])).toBe(true);
	});
	it('is false for non-cutlery classes', () => {
		expect(hasCutlery([{ class: 'cup', score: 0.99 }])).toBe(false);
	});
	it('is false below the threshold', () => {
		expect(hasCutlery([{ class: 'spoon', score: 0.49 }])).toBe(false);
	});
	it('is true at exactly the threshold', () => {
		expect(hasCutlery([{ class: 'knife', score: 0.5 }])).toBe(true);
	});
	it('is false for no predictions', () => {
		expect(hasCutlery([])).toBe(false);
	});
	it('finds cutlery among other predictions', () => {
		expect(
			hasCutlery([
				{ class: 'cup', score: 0.9 },
				{ class: 'spoon', score: 0.6 }
			])
		).toBe(true);
	});
});
