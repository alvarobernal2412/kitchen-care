import { describe, expect, it } from 'vitest';
import {
	evaluateContainerMemory,
	evaluateDatabase,
	evaluateDisk,
	evaluateEventLoop,
	evaluateHostMemory,
	evaluateLoad,
	evaluatePhotos,
	overallStatus
} from '../../src/lib/server/system/thresholds';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('evaluateDisk', () => {
	const big = 1000 * GB; // percent rules decide
	it('is ok at exactly 20% and 10 GB free', () => {
		expect(evaluateDisk({ totalBytes: big, freeBytes: 0.2 * big }).level).toBe('ok');
		expect(evaluateDisk({ totalBytes: 40 * GB, freeBytes: 10 * GB }).level).toBe('ok');
	});
	it('needs attention just below 20% or 10 GB', () => {
		expect(evaluateDisk({ totalBytes: big, freeBytes: 0.2 * big - 1 }).level).toBe('attention');
		expect(evaluateDisk({ totalBytes: 40 * GB, freeBytes: 10 * GB - 1 }).level).toBe('attention');
	});
	it('is attention at exactly 10% and 5 GB, critical just below', () => {
		expect(evaluateDisk({ totalBytes: big, freeBytes: 0.1 * big }).level).toBe('attention');
		expect(evaluateDisk({ totalBytes: 40 * GB, freeBytes: 5 * GB }).level).toBe('attention'); // 12.5%
		expect(evaluateDisk({ totalBytes: big, freeBytes: 0.1 * big - 1 }).level).toBe('critical');
		expect(evaluateDisk({ totalBytes: 40 * GB, freeBytes: 5 * GB - 1 }).level).toBe('critical');
	});
	it('explains itself', () => {
		const r = evaluateDisk({ totalBytes: 100 * GB, freeBytes: 8 * GB });
		expect(r.reason).toMatch(/^Disk: 8% free/);
	});
	it('has no reason when ok, and survives total 0', () => {
		expect(evaluateDisk({ totalBytes: big, freeBytes: big }).reason).toBeUndefined();
		expect(evaluateDisk({ totalBytes: 0, freeBytes: 0 }).level).toBe('critical');
	});
});

describe('evaluatePhotos', () => {
	it('is ok up to 2 GB, attention above, critical above 5 GB', () => {
		expect(evaluatePhotos(2 * GB).level).toBe('ok');
		expect(evaluatePhotos(2 * GB + 1).level).toBe('attention');
		expect(evaluatePhotos(5 * GB).level).toBe('attention');
		expect(evaluatePhotos(5 * GB + 1).level).toBe('critical');
		expect(evaluatePhotos(5 * GB + 1).reason).toMatch(/^Photos: /);
	});
});

describe('evaluateDatabase', () => {
	const base = { reachable: true as const, connections: 10, maxConnections: 100, responseMs: 5 };
	it('is ok in the normal case', () => {
		expect(evaluateDatabase(base).level).toBe('ok');
	});
	it('checks connections at 70% and 90% (strictly above)', () => {
		expect(evaluateDatabase({ ...base, connections: 70 }).level).toBe('ok');
		expect(evaluateDatabase({ ...base, connections: 71 }).level).toBe('attention');
		expect(evaluateDatabase({ ...base, connections: 90 }).level).toBe('attention');
		expect(evaluateDatabase({ ...base, connections: 91 }).level).toBe('critical');
	});
	it('checks response time at 250 ms and 1000 ms (strictly above)', () => {
		expect(evaluateDatabase({ ...base, responseMs: 250 }).level).toBe('ok');
		expect(evaluateDatabase({ ...base, responseMs: 251 }).level).toBe('attention');
		expect(evaluateDatabase({ ...base, responseMs: 1000 }).level).toBe('attention');
		expect(evaluateDatabase({ ...base, responseMs: 1001 }).level).toBe('critical');
	});
	it('is critical when unreachable', () => {
		const r = evaluateDatabase({ reachable: false });
		expect(r.level).toBe('critical');
		expect(r.reason).toBe('Database unreachable');
	});
	it('reports the worst level and names the problem at that level', () => {
		const r = evaluateDatabase({ ...base, connections: 95, responseMs: 300 });
		expect(r.level).toBe('critical');
		expect(r.reason).toMatch(/connections/i);
	});
});

describe('evaluateContainerMemory', () => {
	const limit = 384 * MB;
	it('is ok below 75%, attention from 75%, critical from 90%', () => {
		expect(evaluateContainerMemory({ usedBytes: 0.75 * limit - 1, limitBytes: limit }).level).toBe('ok');
		expect(evaluateContainerMemory({ usedBytes: 0.75 * limit, limitBytes: limit }).level).toBe('attention');
		expect(evaluateContainerMemory({ usedBytes: 0.9 * limit - 1, limitBytes: limit }).level).toBe('attention');
		expect(evaluateContainerMemory({ usedBytes: 0.9 * limit, limitBytes: limit }).level).toBe('critical');
	});
	it('is ok without a limit', () => {
		expect(evaluateContainerMemory({ usedBytes: 10 * GB, limitBytes: null }).level).toBe('ok');
	});
});

describe('evaluateEventLoop', () => {
	it('uses 200 ms and 1 s, strictly above', () => {
		expect(evaluateEventLoop(200).level).toBe('ok');
		expect(evaluateEventLoop(201).level).toBe('attention');
		expect(evaluateEventLoop(1000).level).toBe('attention');
		expect(evaluateEventLoop(1001).level).toBe('critical');
	});
});

describe('evaluateHostMemory', () => {
	it('is ok at 600 MB, attention below, critical below 300 MB', () => {
		expect(evaluateHostMemory(600 * MB).level).toBe('ok');
		expect(evaluateHostMemory(600 * MB - 1).level).toBe('attention');
		expect(evaluateHostMemory(300 * MB).level).toBe('attention');
		expect(evaluateHostMemory(300 * MB - 1).level).toBe('critical');
		expect(evaluateHostMemory(300 * MB - 1).reason).toMatch(/^VPS memory: /);
	});
});

describe('evaluateLoad', () => {
	it('compares the 5-minute load with 1.5x and 3x the CPU count (strictly above)', () => {
		expect(evaluateLoad({ load5: 3, cpus: 2 }).level).toBe('ok');
		expect(evaluateLoad({ load5: 3.01, cpus: 2 }).level).toBe('attention');
		expect(evaluateLoad({ load5: 6, cpus: 2 }).level).toBe('attention');
		expect(evaluateLoad({ load5: 6.01, cpus: 2 }).level).toBe('critical');
	});
	it('treats a missing CPU count as one CPU', () => {
		expect(evaluateLoad({ load5: 1.6, cpus: 0 }).level).toBe('attention');
	});
});

describe('overallStatus', () => {
	it('picks the worst level and lists reasons of every non-ok item', () => {
		const s = overallStatus([
			{ section: 'Disk', result: { level: 'ok' } },
			{ section: 'Photos', result: { level: 'attention', reason: 'Photos: 3.0 GB' } },
			{ section: 'Database', result: { level: 'critical', reason: 'Database unreachable' } }
		]);
		expect(s.level).toBe('critical');
		expect(s.reasons).toEqual(['Photos: 3.0 GB', 'Database unreachable']);
		expect(s.unavailable).toEqual([]);
	});
	it('is ok with no reasons when all is well', () => {
		const s = overallStatus([{ section: 'Disk', result: { level: 'ok' } }]);
		expect(s).toEqual({ level: 'ok', reasons: [], unavailable: [] });
	});
	it('lists unavailable sections without forcing critical', () => {
		const s = overallStatus([
			{ section: 'Disk', result: { level: 'ok' } },
			{ section: 'Database', result: null }
		]);
		expect(s.level).toBe('ok');
		expect(s.unavailable).toEqual(['Database']);
		expect(s.reasons).toEqual(['Database: unavailable']);
	});
	it('is ok for an empty list', () => {
		expect(overallStatus([]).level).toBe('ok');
	});
});
