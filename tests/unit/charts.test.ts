import { describe, expect, it } from 'vitest';
import {
	HEAT_STEPS,
	barHeight,
	formatCount,
	intensityStep,
	isAllZero,
	matrixMax,
	niceMax
} from '../../src/lib/charts';

describe('intensityStep', () => {
	it('is 0 only for zero (or an empty scale)', () => {
		expect(intensityStep(0, 10)).toBe(0);
		expect(intensityStep(5, 0)).toBe(0);
		expect(intensityStep(-1, 10)).toBe(0);
		expect(intensityStep(NaN, 10)).toBe(0);
	});
	it('gives any positive count at least step 1 and the max the top step', () => {
		expect(intensityStep(1, 1000)).toBe(1);
		expect(intensityStep(1000, 1000)).toBe(HEAT_STEPS - 1);
		expect(intensityStep(5000, 1000)).toBe(HEAT_STEPS - 1);
	});
	it('is monotonic', () => {
		let prev = 0;
		for (let c = 0; c <= 40; c++) {
			const s = intensityStep(c, 40);
			expect(s).toBeGreaterThanOrEqual(prev);
			prev = s;
		}
	});
	it('splits evenly', () => {
		expect([1, 2, 3, 4].map((c) => intensityStep(c, 4))).toEqual([1, 2, 3, 4]);
	});
});

describe('barHeight', () => {
	it('scales to the axis and keeps tiny values visible', () => {
		expect(barHeight(0, 10, 100)).toBe(0);
		expect(barHeight(5, 10, 100)).toBe(50);
		expect(barHeight(10, 10, 100)).toBe(100);
		expect(barHeight(1, 1000, 100)).toBe(1);
		expect(barHeight(20, 10, 100)).toBe(100);
		expect(barHeight(5, 0, 100)).toBe(0);
	});
});

describe('niceMax', () => {
	it('rounds up to 1/2/5/10 x 10^k', () => {
		expect(niceMax(0)).toBe(1);
		expect(niceMax(1)).toBe(1);
		expect(niceMax(3)).toBe(5);
		expect(niceMax(7)).toBe(10);
		expect(niceMax(11)).toBe(20);
		expect(niceMax(42)).toBe(50);
		expect(niceMax(100)).toBe(100);
		expect(niceMax(101)).toBe(200);
	});
});

describe('formatCount / matrix helpers', () => {
	it('formats with thousands separators', () => {
		expect(formatCount(1234567)).toBe('1,234,567');
		expect(formatCount(0)).toBe('0');
	});
	it('finds the max and all-zero', () => {
		expect(matrixMax([[0, 2], [5, 1]])).toBe(5);
		expect(isAllZero([[0, 0], [0, 0]])).toBe(true);
		expect(isAllZero([[0, 1]])).toBe(false);
	});
});
