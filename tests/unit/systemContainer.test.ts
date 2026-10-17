import { describe, expect, it } from 'vitest';
import { readContainerMemory } from '../../src/lib/server/system/container';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function files(map: Record<string, string>) {
	return async (p: string) => {
		if (p in map) return map[p];
		throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
	};
}

describe('readContainerMemory', () => {
	it('reads cgroup v2 usage and limit', async () => {
		const r = await readContainerMemory({
			readFile: files({
				'/sys/fs/cgroup/memory.current': `${200 * MB}\n`,
				'/sys/fs/cgroup/memory.max': `${384 * MB}\n`
			}),
			hostTotalBytes: 4 * GB
		});
		expect(r).toEqual({ available: true, usedBytes: 200 * MB, limitBytes: 384 * MB });
	});
	it('treats "max" as no limit', async () => {
		const r = await readContainerMemory({
			readFile: files({
				'/sys/fs/cgroup/memory.current': `${200 * MB}`,
				'/sys/fs/cgroup/memory.max': 'max\n'
			}),
			hostTotalBytes: 4 * GB
		});
		expect(r).toEqual({ available: true, usedBytes: 200 * MB, limitBytes: null });
	});
	it('subtracts reclaimable file cache (inactive_file) when memory.stat is readable', async () => {
		const r = await readContainerMemory({
			readFile: files({
				'/sys/fs/cgroup/memory.current': `${300 * MB}`,
				'/sys/fs/cgroup/memory.max': `${384 * MB}`,
				'/sys/fs/cgroup/memory.stat': `anon 1\ninactive_file ${100 * MB}\nactive_file 5\n`
			}),
			hostTotalBytes: 4 * GB
		});
		expect(r).toMatchObject({ available: true, usedBytes: 200 * MB });
	});
	it('falls back to cgroup v1', async () => {
		const r = await readContainerMemory({
			readFile: files({
				'/sys/fs/cgroup/memory/memory.usage_in_bytes': `${100 * MB}`,
				'/sys/fs/cgroup/memory/memory.limit_in_bytes': `${192 * MB}`
			}),
			hostTotalBytes: 4 * GB
		});
		expect(r).toEqual({ available: true, usedBytes: 100 * MB, limitBytes: 192 * MB });
	});
	it('treats the v1 "unlimited" sentinel and limits above host memory as no limit', async () => {
		const v1 = await readContainerMemory({
			readFile: files({
				'/sys/fs/cgroup/memory/memory.usage_in_bytes': '5',
				'/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712'
			}),
			hostTotalBytes: 4 * GB
		});
		expect(v1).toMatchObject({ available: true, limitBytes: null });
		const big = await readContainerMemory({
			readFile: files({
				'/sys/fs/cgroup/memory.current': '5',
				'/sys/fs/cgroup/memory.max': `${64 * GB}`
			}),
			hostTotalBytes: 4 * GB
		});
		expect(big).toMatchObject({ available: true, limitBytes: null });
	});
	it('is not available when no cgroup files exist or they hold garbage', async () => {
		expect(await readContainerMemory({ readFile: files({}), hostTotalBytes: GB })).toEqual({
			available: false
		});
		expect(
			await readContainerMemory({
				readFile: files({
					'/sys/fs/cgroup/memory.current': 'abc',
					'/sys/fs/cgroup/memory.max': 'max'
				}),
				hostTotalBytes: GB
			})
		).toEqual({ available: false });
	});
});
