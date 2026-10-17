export type AppInfo = {
	version: string;
	nodeVersion: string;
	uptimeSeconds: number;
	rssBytes: number;
	heapUsedBytes: number;
	heapTotalBytes: number;
};

/** The deployed commit (APP_VERSION, set at image build); "dev" when unset or not a plain token. */
export function appVersion(raw: string | undefined = process.env.APP_VERSION): string {
	const v = raw?.trim();
	return v && /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : 'dev';
}

export function collectApp(): AppInfo {
	const mem = process.memoryUsage();
	return {
		version: appVersion(),
		nodeVersion: process.version,
		uptimeSeconds: Math.floor(process.uptime()),
		rssBytes: mem.rss,
		heapUsedBytes: mem.heapUsed,
		heapTotalBytes: mem.heapTotal
	};
}
