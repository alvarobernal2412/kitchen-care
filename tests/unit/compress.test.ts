import { describe, expect, it } from 'vitest';
import { fitWithin } from '../../src/lib/client/compress';

describe('fitWithin', () => {
	it('scales landscape by width', () => {
		expect(fitWithin(4000, 3000, 1080)).toEqual({ width: 1080, height: 810 });
	});
	it('scales portrait by height', () => {
		expect(fitWithin(3000, 4000, 1080)).toEqual({ width: 810, height: 1080 });
	});
	it('never upscales small images', () => {
		expect(fitWithin(640, 480, 1080)).toEqual({ width: 640, height: 480 });
	});
	it('keeps an image exactly at the boundary', () => {
		expect(fitWithin(1080, 600, 1080)).toEqual({ width: 1080, height: 600 });
	});
	it('never returns a zero dimension', () => {
		expect(fitWithin(10000, 1, 1080)).toEqual({ width: 1080, height: 1 });
	});
});
