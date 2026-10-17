import { readdir as fsReaddir, stat as fsStat } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Uploads directory statistics. The directory is flat (one `<32 hex>.webp` per photo), so this
 * lists it once and stats the files with bounded concurrency; sub-directories are never entered.
 * Only `*.webp` files are counted and summed; everything else is reported as `otherFiles`.
 * The result is cached in module memory for 60 s so repeated refreshes stay cheap.
 */

export const PHOTO_CACHE_MS = 60_000;
const DEFAULT_MAX_FILES = 100_000;
const STAT_CONCURRENCY = 64;

export type PhotoStats = {
	exists: boolean;
	count: number;
	totalBytes: number;
	oldest: string | null;
	newest: string | null;
	/** Entries that are not `.webp` files (not counted in the totals). */
	otherFiles: number;
	/** The directory had more files than the cap; the numbers cover the first `maxFiles`. */
	truncated: boolean;
};

export type PhotoDeps = {
	dir: string;
	now?: () => number;
	maxFiles?: number;
	readdir?: typeof fsReaddir;
	stat?: typeof fsStat;
};

const cache = new Map<string, { at: number; value: PhotoStats }>();
const inflight = new Map<string, Promise<PhotoStats>>();

export function resetPhotoCache(): void {
	cache.clear();
	inflight.clear();
}

async function scan(deps: PhotoDeps): Promise<PhotoStats> {
	const readdir = deps.readdir ?? fsReaddir;
	const stat = deps.stat ?? fsStat;
	const max = deps.maxFiles ?? DEFAULT_MAX_FILES;
	let entries;
	try {
		entries = await readdir(deps.dir, { withFileTypes: true });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return { exists: false, count: 0, totalBytes: 0, oldest: null, newest: null, otherFiles: 0, truncated: false };
		}
		throw e;
	}

	const webp: string[] = [];
	let otherFiles = 0;
	let truncated = false;
	for (const e of entries) {
		if (e.isFile() && e.name.endsWith('.webp')) {
			if (webp.length >= max) truncated = true;
			else webp.push(e.name);
		} else if (!e.isDirectory()) {
			otherFiles++;
		}
	}

	let count = 0;
	let totalBytes = 0;
	let oldest = Infinity;
	let newest = -Infinity;
	let next = 0;
	const worker = async () => {
		while (next < webp.length) {
			const name = webp[next++];
			try {
				const s = await stat(join(deps.dir, name));
				count++;
				totalBytes += s.size;
				oldest = Math.min(oldest, s.mtimeMs);
				newest = Math.max(newest, s.mtimeMs);
			} catch {
				// removed between listing and stat: skip it
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, webp.length) }, worker));

	return {
		exists: true,
		count,
		totalBytes,
		oldest: count ? new Date(oldest).toISOString() : null,
		newest: count ? new Date(newest).toISOString() : null,
		otherFiles,
		truncated
	};
}

export async function getPhotoStats(deps: PhotoDeps): Promise<PhotoStats> {
	const now = (deps.now ?? Date.now)();
	const hit = cache.get(deps.dir);
	if (hit && now - hit.at < PHOTO_CACHE_MS) return hit.value;
	const running = inflight.get(deps.dir);
	if (running) return running;
	const p = scan(deps)
		.then((value) => {
			cache.set(deps.dir, { at: now, value });
			return value;
		})
		.finally(() => inflight.delete(deps.dir));
	inflight.set(deps.dir, p);
	return p;
}
