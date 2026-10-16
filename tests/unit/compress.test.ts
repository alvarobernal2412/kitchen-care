import { describe, expect, it } from 'vitest';
import { encodeUnderLimit, fitWithin } from '../../src/lib/client/compress';

describe('encodeUnderLimit', () => {
	const mk = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

	it('prefers webp and stops at the first quality under the limit', async () => {
		const calls: [string, number][] = [];
		const out = await encodeUnderLimit(async (type, q) => {
			calls.push([type, q]);
			return mk(type, q > 0.7 ? 300 * 1024 : 100 * 1024);
		});
		expect(out.type).toBe('image/webp');
		expect(calls).toEqual([
			['image/webp', 0.8],
			['image/webp', 0.7]
		]);
	});

	it('falls back to jpeg when the browser returns a non-webp type', async () => {
		const calls: [string, number][] = [];
		const out = await encodeUnderLimit(async (type, q) => {
			calls.push([type, q]);
			return mk(type === 'image/webp' ? 'image/png' : type, 10);
		});
		expect(out.type).toBe('image/jpeg');
		expect(calls).toEqual([
			['image/webp', 0.8],
			['image/jpeg', 0.8]
		]);
	});

	it('keeps stepping with jpeg once fallen back', async () => {
		const calls: [string, number][] = [];
		await encodeUnderLimit(async (type, q) => {
			calls.push([type, q]);
			return mk(type === 'image/webp' ? 'image/png' : type, 400 * 1024);
		});
		expect(calls).toEqual([
			['image/webp', 0.8],
			['image/jpeg', 0.8],
			['image/jpeg', 0.7],
			['image/jpeg', 0.6],
			['image/jpeg', 0.5]
		]);
	});

	it('returns the last step when nothing gets under the limit', async () => {
		const qualities: number[] = [];
		const out = await encodeUnderLimit(async (type, q) => {
			qualities.push(q);
			return mk(type, 400 * 1024);
		});
		expect(qualities).toEqual([0.8, 0.7, 0.6, 0.5]);
		expect(out.size).toBe(400 * 1024);
	});

	it('throws only when encoding returns null', async () => {
		await expect(encodeUnderLimit(async () => null)).rejects.toThrow();
	});
});

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
