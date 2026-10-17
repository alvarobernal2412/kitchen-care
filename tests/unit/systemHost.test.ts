import { describe, expect, it } from 'vitest';
import { parseMeminfo, readDisk, readLoad, readMemory } from '../../src/lib/server/system/host';

const MEMINFO = `MemTotal:        2048000 kB
MemFree:          100000 kB
MemAvailable:    1024000 kB
Buffers:           50000 kB
`;

describe('parseMeminfo', () => {
	it('reads MemTotal and MemAvailable in bytes', () => {
		expect(parseMeminfo(MEMINFO)).toEqual({
			totalBytes: 2048000 * 1024,
			availableBytes: 1024000 * 1024
		});
	});
	it('returns null availability when MemAvailable is missing', () => {
		expect(parseMeminfo('MemTotal: 1000 kB\nMemFree: 10 kB\n')).toEqual({
			totalBytes: 1000 * 1024,
			availableBytes: null
		});
	});
	it('survives garbage', () => {
		expect(parseMeminfo('')).toEqual({ totalBytes: null, availableBytes: null });
		expect(parseMeminfo('MemAvailable: lots kB\n\u0000\u0001')).toEqual({
			totalBytes: null,
			availableBytes: null
		});
	});
});

describe('readMemory', () => {
	const os = { freemem: () => 111, totalmem: () => 999 };
	it('prefers /proc/meminfo', async () => {
		const m = await readMemory({ readFile: async () => MEMINFO, os });
		expect(m).toEqual({ totalBytes: 2048000 * 1024, availableBytes: 1024000 * 1024 });
	});
	it('falls back to os when the file is missing', async () => {
		const m = await readMemory({
			readFile: async () => {
				throw new Error('ENOENT');
			},
			os
		});
		expect(m).toEqual({ totalBytes: 999, availableBytes: 111 });
	});
	it('falls back to os when MemAvailable is missing', async () => {
		const m = await readMemory({ readFile: async () => 'MemTotal: 5 kB\n', os });
		expect(m).toEqual({ totalBytes: 999, availableBytes: 111 });
	});
});

describe('readDisk', () => {
	it('maps statfs to total, used and free (free = what an unprivileged process may use)', async () => {
		const seen: string[] = [];
		const d = await readDisk('/data/uploads', {
			statfs: async (p) => {
				seen.push(p);
				return { bsize: 4096, blocks: 1000, bfree: 400, bavail: 300 };
			}
		});
		expect(d).toEqual({ totalBytes: 4096000, usedBytes: 600 * 4096, freeBytes: 300 * 4096 });
		expect(seen[0]).toMatch(/data$/); // the parent of the uploads directory
	});
	it('walks up when the parent does not exist', async () => {
		const seen: string[] = [];
		const d = await readDisk('/a/b/c/uploads', {
			statfs: async (p) => {
				seen.push(p);
				if (seen.length < 3) throw Object.assign(new Error('x'), { code: 'ENOENT' });
				return { bsize: 1, blocks: 10, bfree: 5, bavail: 5 };
			}
		});
		expect(seen.length).toBe(3);
		expect(d.totalBytes).toBe(10);
	});
	it('rejects when nothing can be read', async () => {
		await expect(
			readDisk('/x/uploads', {
				statfs: async () => {
					throw new Error('nope');
				}
			})
		).rejects.toThrow();
	});
});

describe('readLoad', () => {
	it('maps loadavg with an injected CPU count', () => {
		expect(readLoad({ loadavg: () => [0.5, 1.25, 2], cpus: () => 4 })).toEqual({
			load1: 0.5,
			load5: 1.25,
			load15: 2,
			cpus: 4
		});
	});
	it('never reports fewer than one CPU', () => {
		expect(readLoad({ loadavg: () => [0, 0, 0], cpus: () => 0 }).cpus).toBe(1);
	});
});
