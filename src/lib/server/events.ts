import type { Db } from './db';
import { events } from './db/schema';

/** At most one app_open event per user per this window. */
export const APP_OPEN_WINDOW_MS = 30 * 60 * 1000;

/**
 * userId -> time of the last recorded app_open. In memory on purpose (no DB read per
 * request); approximate across restarts and multiple instances, which only means an
 * occasional extra event.
 */
const lastRecorded = new Map<number, number>();

/** Clears the throttle (tests). */
export function resetAppOpenThrottle(): void {
	lastRecorded.clear();
}

/**
 * Writes an app_open event unless one was written for this user in the last 30 minutes.
 * Resolves true when an event was written. The throttle slot is claimed before the insert
 * so concurrent requests cannot double-write, and released again if the insert fails.
 */
export async function recordAppOpen(
	db: Pick<Db, 'insert'>,
	userId: number,
	now: Date = new Date()
): Promise<boolean> {
	const prev = lastRecorded.get(userId);
	const at = now.getTime();
	if (prev !== undefined && at - prev < APP_OPEN_WINDOW_MS) return false;
	lastRecorded.set(userId, at);
	try {
		await db.insert(events).values({ userId, type: 'app_open', createdAt: now });
		return true;
	} catch (err) {
		if (prev === undefined) lastRecorded.delete(userId);
		else lastRecorded.set(userId, prev);
		throw err;
	}
}

const EXCLUDED_PREFIXES = ['/api', '/media', '/healthz', '/_app'];

/**
 * True for requests that represent a person opening a page: a document GET, or the
 * SvelteKit `__data.json` fetch behind a client-side navigation. API calls, media,
 * health checks, static assets and form POSTs are not app opens.
 */
export function shouldRecordAppOpen(request: Request, url: URL): boolean {
	if (request.method !== 'GET') return false;
	const p = url.pathname;
	if (EXCLUDED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return false;
	if (p.endsWith('/__data.json')) return true;
	return (request.headers.get('accept') ?? '').includes('text/html');
}
