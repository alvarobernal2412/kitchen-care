import { monitorEventLoopDelay } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

/*
 * Event loop delay p99 over (about) the last minute. One lazily started module singleton; the
 * histogram is reset once a minute and the previous window's figure is served while the new one
 * has no samples yet. The monitor is unref'd so it never keeps the process alive.
 */

const WINDOW_MS = 60_000;
const NS_PER_MS = 1e6;

let histogram: IntervalHistogram | undefined;
let windowStart = 0;
let previousP99: number | null = null;

export type EventLoopInfo = { p99Ms: number | null };

export async function getEventLoopP99(now: number = Date.now()): Promise<EventLoopInfo> {
	if (!histogram) {
		histogram = monitorEventLoopDelay({ resolution: 20 });
		histogram.enable();
		// The sampling timer of a Node histogram is already unref'd; this is a no-op where supported.
		(histogram as unknown as { unref?: () => void }).unref?.();
		windowStart = now;
		// First call: let a few 20 ms samples accumulate so the page has a figure straight away.
		await new Promise((r) => setTimeout(r, 120).unref());
	}
	let p99Ms: number | null = histogram.count > 0 ? histogram.percentile(99) / NS_PER_MS : previousP99;
	if (now - windowStart >= WINDOW_MS) {
		if (histogram.count > 0) previousP99 = histogram.percentile(99) / NS_PER_MS;
		histogram.reset();
		windowStart = now;
	}
	if (p99Ms !== null && !Number.isFinite(p99Ms)) p99Ms = null;
	return { p99Ms };
}
