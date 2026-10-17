import { statfs as fsStatfs, readFile as fsReadFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';

/*
 * Host readers. Inside the container /proc/meminfo, os.loadavg() and statfs on the uploads volume
 * all describe the VPS, not the container. Every seam is injectable for tests.
 */

export type MemInfo = { totalBytes: number | null; availableBytes: number | null };

function kbField(text: string, name: string): number | null {
	const m = new RegExp(`^${name}:\\s+(\\d+)\\s*kB\\s*$`, 'm').exec(text);
	return m ? Number(m[1]) * 1024 : null;
}

export function parseMeminfo(text: string): MemInfo {
	return { totalBytes: kbField(text, 'MemTotal'), availableBytes: kbField(text, 'MemAvailable') };
}

export type MemoryDeps = {
	readFile: (path: string) => Promise<string>;
	os: Pick<typeof os, 'freemem' | 'totalmem'>;
};

/** Available memory: MemAvailable on Linux, os.freemem() elsewhere (or if the file is unusable). */
export async function readMemory(
	deps: MemoryDeps = { readFile: (p) => fsReadFile(p, 'utf8'), os }
): Promise<{ totalBytes: number; availableBytes: number }> {
	try {
		const m = parseMeminfo(await deps.readFile('/proc/meminfo'));
		if (m.totalBytes !== null && m.availableBytes !== null) {
			return { totalBytes: m.totalBytes, availableBytes: m.availableBytes };
		}
	} catch {
		// not Linux, or /proc is hidden: use the os module
	}
	return { totalBytes: deps.os.totalmem(), availableBytes: deps.os.freemem() };
}

export type StatfsResult = { bsize: number; blocks: number; bfree: number; bavail: number };
export type DiskDeps = { statfs: (path: string) => Promise<StatfsResult> };
export type Disk = { totalBytes: number; usedBytes: number; freeBytes: number };

/**
 * The filesystem holding `uploadDir`'s parent (the uploads volume sits on the host disk). If the
 * parent is missing, the nearest existing ancestor is used. Free is `bavail`: what a non-root
 * process can actually write.
 */
export async function readDisk(
	uploadDir: string,
	deps: DiskDeps = { statfs: (p) => fsStatfs(p) }
): Promise<Disk> {
	let path = dirname(resolve(uploadDir));
	for (;;) {
		try {
			const s = await deps.statfs(path);
			return {
				totalBytes: s.blocks * s.bsize,
				usedBytes: (s.blocks - s.bfree) * s.bsize,
				freeBytes: s.bavail * s.bsize
			};
		} catch (e) {
			const parent = dirname(path);
			if (parent === path) throw e;
			path = parent;
		}
	}
}

export type LoadDeps = { loadavg: () => number[]; cpus: () => number };
export type Load = { load1: number; load5: number; load15: number; cpus: number };

export function readLoad(
	deps: LoadDeps = { loadavg: () => os.loadavg(), cpus: () => os.availableParallelism() }
): Load {
	const [load1 = 0, load5 = 0, load15 = 0] = deps.loadavg();
	return { load1, load5, load15, cpus: Math.max(1, deps.cpus()) };
}
