import { readFile as fsReadFile } from 'node:fs/promises';

/*
 * Container memory from cgroups (v2 first, then v1). Anything missing or unparsable means
 * "not available" (macOS/Windows dev, restricted /sys). The usage figure excludes inactive file
 * cache (what `docker stats` does), because the kernel reclaims it before it would OOM-kill.
 */

export type ContainerMemory =
	| { available: false }
	| { available: true; usedBytes: number; limitBytes: number | null };

export type ContainerDeps = {
	readFile: (path: string) => Promise<string>;
	/** Limits above this are "no limit" (cgroup v1 reports a huge sentinel for unlimited). */
	hostTotalBytes: number;
};

const num = (s: string | null): number | null => {
	if (s === null) return null;
	const t = s.trim();
	return /^\d+$/.test(t) ? Number(t) : null;
};

async function tryRead(deps: ContainerDeps, path: string): Promise<string | null> {
	try {
		return await deps.readFile(path);
	} catch {
		return null;
	}
}

function statField(text: string | null, name: string): number {
	if (!text) return 0;
	const m = new RegExp(`^${name}\\s+(\\d+)\\s*$`, 'm').exec(text);
	return m ? Number(m[1]) : 0;
}

function limitOrNull(raw: string | null, deps: ContainerDeps): number | null {
	const n = num(raw); // "max" and garbage are null
	if (n === null || n <= 0) return null;
	if (n >= 2 ** 60) return null;
	if (deps.hostTotalBytes > 0 && n > deps.hostTotalBytes) return null;
	return n;
}

export async function readContainerMemory(
	deps: ContainerDeps = { readFile: (p) => fsReadFile(p, 'utf8'), hostTotalBytes: 0 }
): Promise<ContainerMemory> {
	const v2 = num(await tryRead(deps, '/sys/fs/cgroup/memory.current'));
	if (v2 !== null) {
		const stat = await tryRead(deps, '/sys/fs/cgroup/memory.stat');
		const used = Math.max(0, v2 - statField(stat, 'inactive_file'));
		return {
			available: true,
			usedBytes: used,
			limitBytes: limitOrNull(await tryRead(deps, '/sys/fs/cgroup/memory.max'), deps)
		};
	}
	const v1 = num(await tryRead(deps, '/sys/fs/cgroup/memory/memory.usage_in_bytes'));
	if (v1 !== null) {
		const stat = await tryRead(deps, '/sys/fs/cgroup/memory/memory.stat');
		const used = Math.max(0, v1 - statField(stat, 'total_inactive_file'));
		return {
			available: true,
			usedBytes: used,
			limitBytes: limitOrNull(
				await tryRead(deps, '/sys/fs/cgroup/memory/memory.limit_in_bytes'),
				deps
			)
		};
	}
	return { available: false };
}
