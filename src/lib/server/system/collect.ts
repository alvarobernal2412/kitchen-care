import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import type { Db } from '$lib/server/db';
import { collectActivity, type ActivityInfo } from './activity';
import { collectApp, type AppInfo } from './app';
import { readContainerMemory, type ContainerMemory } from './container';
import { collectDatabase, type DatabaseInfo } from './database';
import { getEventLoopP99 } from './eventLoop';
import { readDisk, readLoad, readMemory, type Disk, type Load } from './host';
import { getPhotoStats, type PhotoStats } from './photos';
import {
	evaluateContainerMemory,
	evaluateDatabase,
	evaluateDbConnections,
	evaluateDbResponse,
	evaluateDisk,
	evaluateEventLoop,
	evaluateHostMemory,
	evaluateLoad,
	evaluatePhotos,
	overallStatus,
	type OverallStatus,
	type Result
} from './thresholds';

/*
 * Runs every collector independently. A collector that throws or takes longer than the timeout
 * becomes `null` ("unavailable") for its section; the page still renders. Everything returned is
 * plain JSON (numbers, strings, booleans): no paths, environment values or connection details.
 */

export const COLLECTOR_TIMEOUT_MS = 3000;

/** A section's data plus its health; `null` when its collector failed or timed out. */
export type Section<T> = (T & { status: Result }) | null;

export type SystemSnapshot = {
	generatedAt: string;
	overall: OverallStatus;
	disk: Section<Disk>;
	photos: Section<PhotoStats>;
	database: Section<DatabaseInfo & { connectionsStatus?: Result; responseStatus?: Result }>;
	app: Section<AppInfo>;
	container: Section<ContainerMemory>;
	eventLoop: Section<{ p99Ms: number | null }>;
	hostMemory: Section<{ totalBytes: number; availableBytes: number }>;
	load: Section<Load>;
	activity: Section<ActivityInfo>;
};

export type CollectDeps = {
	getDb: () => Db;
	/** The configured uploads directory (defaults to UPLOAD_DIR resolved like images.ts). */
	uploadDir?: string;
	timeoutMs?: number;
};

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('timeout')), ms);
	});
	return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const OK: Result = { level: 'ok' };

export async function collectSystem(deps: CollectDeps): Promise<SystemSnapshot> {
	const ms = deps.timeoutMs ?? COLLECTOR_TIMEOUT_MS;
	const uploadDir = deps.uploadDir ?? resolve(process.env.UPLOAD_DIR ?? './uploads');
	// Each collector starts inside an async callback, so a synchronous throw is captured as well.
	const run = <T>(fn: () => T | Promise<T>) => withTimeout((async () => fn())(), ms);

	const [disk, photos, database, app, container, eventLoop, hostMemory, load, activity] =
		await Promise.allSettled([
			run(() => readDisk(uploadDir)),
			run(() => getPhotoStats({ dir: uploadDir })),
			run(() => collectDatabase(deps.getDb())),
			run(() => collectApp()),
			run(() =>
				readContainerMemory({ readFile: (p) => readFile(p, 'utf8'), hostTotalBytes: os.totalmem() })
			),
			run(() => getEventLoopP99()),
			run(() => readMemory()),
			run(() => readLoad()),
			run(() => collectActivity(deps.getDb()))
		]);

	/** Attaches the health of a fulfilled collector; a failed one stays null. */
	const section = <T, E extends object = object>(
		r: PromiseSettledResult<T>,
		evaluate: (v: T) => Result,
		extra?: (v: T) => E
	): Section<T & E> =>
		r.status === 'fulfilled'
			? { ...r.value, ...(extra?.(r.value) as E), status: evaluate(r.value) }
			: null;

	const s = {
		disk: section(disk, evaluateDisk),
		photos: section(photos, (p) => (p.exists ? evaluatePhotos(p.totalBytes) : OK)),
		database: section(database, evaluateDatabase, (d) =>
			d.reachable
				? {
						connectionsStatus: evaluateDbConnections(d.connections, d.maxConnections),
						responseStatus: evaluateDbResponse(d.responseMs)
					}
				: {}
		),
		app: section(app, () => OK),
		container: section(container, (c) => (c.available ? evaluateContainerMemory(c) : OK)),
		eventLoop: section(eventLoop, (e) => (e.p99Ms === null ? OK : evaluateEventLoop(e.p99Ms))),
		hostMemory: section(hostMemory, (m) => evaluateHostMemory(m.availableBytes)),
		load: section(load, evaluateLoad),
		activity: section(activity, () => OK)
	};

	const overall = overallStatus([
		{ section: 'Disk', result: s.disk?.status ?? null },
		{ section: 'Photos', result: s.photos?.status ?? null },
		{ section: 'Database', result: s.database?.status ?? null },
		{ section: 'App memory', result: s.container?.status ?? null },
		{ section: 'Event loop', result: s.eventLoop?.status ?? null },
		{ section: 'VPS memory', result: s.hostMemory?.status ?? null },
		{ section: 'VPS load', result: s.load?.status ?? null }
	]);

	return { generatedAt: new Date().toISOString(), overall, ...s };
}
