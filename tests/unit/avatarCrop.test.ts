import { describe, expect, it } from 'vitest';
import { squareCrop } from '../../src/lib/client/avatar';

describe('squareCrop', () => {
	it('centers a landscape image', () => {
		expect(squareCrop(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
	});
	it('centers a portrait image', () => {
		expect(squareCrop(200, 401)).toEqual({ sx: 0, sy: 100, side: 200 });
	});
	it('keeps a square as is', () => {
		expect(squareCrop(300, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
	});
});
