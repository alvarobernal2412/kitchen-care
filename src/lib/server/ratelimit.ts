// In-memory sliding-window limiter. Per-process only (single app container); nginx limits too.
const hits = new Map<string, number[]>();
let lastSweep = 0;
let maxWindow = 0;

/** Records an attempt for `key`. Returns true if allowed, false if over `limit` within `windowMs`. */
export function hit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	maxWindow = Math.max(maxWindow, windowMs);
	sweep(now);
	const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
	if (recent.length >= limit) {
		hits.set(key, recent);
		return false;
	}
	recent.push(now);
	hits.set(key, recent);
	return true;
}

// Occasionally drop keys whose newest hit is older than the window so the map cannot grow forever.
function sweep(now: number): void {
	if (now - lastSweep < 60_000) return;
	lastSweep = now;
	for (const [key, ts] of hits) {
		if (ts.length === 0 || now - ts[ts.length - 1] >= maxWindow) hits.delete(key);
	}
}

/** Test helper. */
export function resetRateLimits(): void {
	hits.clear();
	lastSweep = 0;
}
