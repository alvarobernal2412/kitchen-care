/*
 * Health thresholds for the admin System page. Pure functions: every limit lives here, so this is
 * the one file to edit to change what counts as "Attention" or "Critical". All comparisons are
 * strict on the "worse" side unless noted: a value exactly at a limit is still the better level.
 */
import { formatBytes, formatMs, formatPercent } from '$lib/systemFormat';

export type Level = 'ok' | 'attention' | 'critical';
export type Result = { level: Level; reason?: string };

const MB = 1024 ** 2;
const GB = 1024 ** 3;

export const LIMITS = {
	diskFreePercent: { attention: 20, critical: 10 },
	diskFreeBytes: { attention: 10 * GB, critical: 5 * GB },
	photosBytes: { attention: 2 * GB, critical: 5 * GB },
	dbConnectionsRatio: { attention: 0.7, critical: 0.9 },
	dbResponseMs: { attention: 250, critical: 1000 },
	/** Container memory: attention at or above, critical at or above. */
	containerMemoryRatio: { attention: 0.75, critical: 0.9 },
	eventLoopP99Ms: { attention: 200, critical: 1000 },
	/** Host available memory: attention below, critical below (the deploy script refuses to build below 900/400 MB). */
	hostAvailableBytes: { attention: 600 * MB, critical: 300 * MB },
	loadPerCpu: { attention: 1.5, critical: 3 }
} as const;

const RANK: Record<Level, number> = { ok: 0, attention: 1, critical: 2 };
export const worseOf = (a: Level, b: Level): Level => (RANK[b] > RANK[a] ? b : a);

const ok = (): Result => ({ level: 'ok' });

/** Worst level wins; the reasons of the results at that level are joined. */
function worst(results: Result[]): Result {
	const level = results.reduce<Level>((acc, r) => worseOf(acc, r.level), 'ok');
	if (level === 'ok') return ok();
	const reasons = results.filter((r) => r.level === level && r.reason).map((r) => r.reason);
	return { level, reason: reasons.join('; ') };
}

/** Free share below `percent`, compared without dividing so exact limits stay exact. */
const below = (d: { totalBytes: number; freeBytes: number }, percent: number) =>
	d.freeBytes * 100 < d.totalBytes * percent;

export function evaluateDisk(d: { totalBytes: number; freeBytes: number }): Result {
	const pct = d.totalBytes > 0 ? (d.freeBytes / d.totalBytes) * 100 : 0;
	const label = `Disk: ${formatPercent(pct)} free (${formatBytes(d.freeBytes)})`;
	if (d.totalBytes <= 0) return { level: 'critical', reason: 'Disk: size unknown' };
	if (below(d, LIMITS.diskFreePercent.critical) || d.freeBytes < LIMITS.diskFreeBytes.critical) {
		return { level: 'critical', reason: label };
	}
	if (below(d, LIMITS.diskFreePercent.attention) || d.freeBytes < LIMITS.diskFreeBytes.attention) {
		return { level: 'attention', reason: label };
	}
	return ok();
}

export function evaluatePhotos(totalBytes: number): Result {
	const reason = `Photos: ${formatBytes(totalBytes)} stored`;
	if (totalBytes > LIMITS.photosBytes.critical) return { level: 'critical', reason };
	if (totalBytes > LIMITS.photosBytes.attention) return { level: 'attention', reason };
	return ok();
}

export type DatabaseHealth =
	| { reachable: false }
	| { reachable: true; connections: number; maxConnections: number; responseMs: number };

export function evaluateDbConnections(connections: number, maxConnections: number): Result {
	const ratio = maxConnections > 0 ? connections / maxConnections : 0;
	const reason = `Database connections: ${connections} of ${maxConnections}`;
	if (ratio > LIMITS.dbConnectionsRatio.critical) return { level: 'critical', reason };
	if (ratio > LIMITS.dbConnectionsRatio.attention) return { level: 'attention', reason };
	return ok();
}

export function evaluateDbResponse(responseMs: number): Result {
	const reason = `Database response: ${formatMs(responseMs)}`;
	if (responseMs > LIMITS.dbResponseMs.critical) return { level: 'critical', reason };
	if (responseMs > LIMITS.dbResponseMs.attention) return { level: 'attention', reason };
	return ok();
}

export function evaluateDatabase(d: DatabaseHealth): Result {
	if (!d.reachable) return { level: 'critical', reason: 'Database unreachable' };
	return worst([
		evaluateDbConnections(d.connections, d.maxConnections),
		evaluateDbResponse(d.responseMs)
	]);
}

export function evaluateContainerMemory(m: { usedBytes: number; limitBytes: number | null }): Result {
	if (m.limitBytes === null || m.limitBytes <= 0) return ok();
	const ratio = m.usedBytes / m.limitBytes;
	const reason = `App memory: ${formatPercent(ratio * 100)} of the container limit`;
	if (ratio >= LIMITS.containerMemoryRatio.critical) return { level: 'critical', reason };
	if (ratio >= LIMITS.containerMemoryRatio.attention) return { level: 'attention', reason };
	return ok();
}

export function evaluateEventLoop(p99Ms: number): Result {
	const reason = `Event loop delay: ${formatMs(p99Ms)} (p99)`;
	if (p99Ms > LIMITS.eventLoopP99Ms.critical) return { level: 'critical', reason };
	if (p99Ms > LIMITS.eventLoopP99Ms.attention) return { level: 'attention', reason };
	return ok();
}

export function evaluateHostMemory(availableBytes: number): Result {
	const reason = `VPS memory: ${formatBytes(availableBytes)} available`;
	if (availableBytes < LIMITS.hostAvailableBytes.critical) return { level: 'critical', reason };
	if (availableBytes < LIMITS.hostAvailableBytes.attention) return { level: 'attention', reason };
	return ok();
}

export function evaluateLoad(l: { load5: number; cpus: number }): Result {
	const cpus = Math.max(1, l.cpus);
	const reason = `VPS load: ${l.load5.toFixed(2)} (5 min) on ${cpus} ${cpus === 1 ? 'CPU' : 'CPUs'}`;
	if (l.load5 > cpus * LIMITS.loadPerCpu.critical) return { level: 'critical', reason };
	if (l.load5 > cpus * LIMITS.loadPerCpu.attention) return { level: 'attention', reason };
	return ok();
}

export type StatusItem = { section: string; result: Result | null };
export type OverallStatus = { level: Level; reasons: string[]; unavailable: string[] };

/**
 * The worst level of all available items. An unavailable item (`result: null`, a collector that
 * failed or timed out) is listed but never raises the level by itself.
 */
export function overallStatus(items: StatusItem[]): OverallStatus {
	let level: Level = 'ok';
	const reasons: string[] = [];
	const unavailable: string[] = [];
	for (const { section, result } of items) {
		if (!result) {
			unavailable.push(section);
			reasons.push(`${section}: unavailable`);
			continue;
		}
		level = worseOf(level, result.level);
		if (result.level !== 'ok') reasons.push(result.reason ?? section);
	}
	return { level, reasons, unavailable };
}
