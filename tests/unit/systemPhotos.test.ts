import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPhotoStats, resetPhotoCache } from '../../src/lib/server/system/photos';

let dir: string;
beforeEach(async () => {
	resetPhotoCache();
	dir = await mkdtemp(join(tmpdir(), 'kc-photos-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function photo(name: string, bytes: number, mtime: Date) {
	const p = join(dir, name);
	await writeFile(p, Buffer.alloc(bytes));
	await utimes(p, mtime, mtime);
}

describe('getPhotoStats', () => {
	it('reports an empty directory', async () => {
		const s = await getPhotoStats({ dir });
		expect(s).toMatchObject({ exists: true, count: 0, totalBytes: 0, oldest: null, newest: null });
	});

	it('reports a missing directory without throwing', async () => {
		const s = await getPhotoStats({ dir: join(dir, 'nope') });
		expect(s).toMatchObject({ exists: false, count: 0, totalBytes: 0, oldest: null, newest: null });
	});

	it('sums sizes and finds the oldest and newest mtime', async () => {
		await photo('a'.repeat(32) + '.webp', 100, new Date('2026-01-02T00:00:00Z'));
		await photo('b'.repeat(32) + '.webp', 250, new Date('2026-03-04T05:06:07Z'));
		await photo('c'.repeat(32) + '.webp', 50, new Date('2026-02-01T00:00:00Z'));
		const s = await getPhotoStats({ dir });
		expect(s.count).toBe(3);
		expect(s.totalBytes).toBe(400);
		expect(s.oldest).toBe('2026-01-02T00:00:00.000Z');
		expect(s.newest).toBe('2026-03-04T05:06:07.000Z');
	});

	it('counts only .webp files; anything else is reported separately and not summed', async () => {
		await photo('a.webp', 10, new Date('2026-01-01T00:00:00Z'));
		await photo('notes.txt', 999, new Date('2026-01-01T00:00:00Z'));
		await mkdir(join(dir, 'sub.webp'));
		await writeFile(join(dir, 'sub.webp', 'deep.webp'), 'x');
		const s = await getPhotoStats({ dir });
		expect(s.count).toBe(1);
		expect(s.totalBytes).toBe(10);
		expect(s.otherFiles).toBe(1);
	});

	it('serves the cache within 60 s and refreshes after', async () => {
		let now = 1_000_000;
		await photo('a.webp', 10, new Date('2026-01-01T00:00:00Z'));
		const first = await getPhotoStats({ dir, now: () => now });
		expect(first.count).toBe(1);
		await photo('b.webp', 10, new Date('2026-01-02T00:00:00Z'));
		now += 59_000;
		expect((await getPhotoStats({ dir, now: () => now })).count).toBe(1);
		now += 2_000;
		expect((await getPhotoStats({ dir, now: () => now })).count).toBe(2);
	});

	it('handles 5,000 tiny files in under a second', async () => {
		const names = Array.from({ length: 5000 }, (_, i) => `${String(i).padStart(32, '0')}.webp`);
		await Promise.all(names.map((n) => writeFile(join(dir, n), 'x')));
		const t0 = performance.now();
		const s = await getPhotoStats({ dir });
		expect(performance.now() - t0).toBeLessThan(1000);
		expect(s.count).toBe(5000);
		expect(s.totalBytes).toBe(5000);
	});

	it('stops at the file cap and says so', async () => {
		for (let i = 0; i < 5; i++) await photo(`${i}.webp`, 1, new Date());
		const s = await getPhotoStats({ dir, maxFiles: 3 });
		expect(s.truncated).toBe(true);
		expect(s.count).toBe(3);
	});
});
