// Pure request routing for the service worker (no `self` / `$service-worker` here, so it can be
// unit tested). The worker only ever touches same-origin GET requests it has a clear policy for;
// everything else goes straight to the browser, because pages and API data are per-user.

export type SwRequest = {
	method: string;
	mode: string;
	url: string;
	/** Lower-case header names. */
	headers: Record<string, string>;
};

export type RouteKind = 'navigate' | 'asset' | 'bypass';

/**
 * - `navigate`: a page load; network first, offline page as the fallback, never cached.
 * - `asset`: a precached build/static file; cache first.
 * - `bypass`: do not intercept.
 *
 * @param precachedPaths pathnames of the files precached at install time.
 */
export function classify(
	request: SwRequest,
	origin: string,
	precachedPaths: ReadonlySet<string>
): RouteKind {
	if (request.method !== 'GET') return 'bypass';

	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return 'bypass';
	}
	if (url.origin !== origin) return 'bypass';
	if (request.headers['range'] !== undefined) return 'bypass';

	const { pathname } = url;
	if (pathname === '/api' || pathname.startsWith('/api/')) return 'bypass';
	if (pathname.startsWith('/media/')) return 'bypass';
	if (pathname.endsWith('/__data.json')) return 'bypass';

	if (request.mode === 'navigate') return 'navigate';
	return precachedPaths.has(pathname) ? 'asset' : 'bypass';
}
