// Paths reachable without a session. Everything else requires one (see hooks.server.ts).
// The check is deliberately literal: no decoding, no case folding. Anything that is not an
// exact match fails closed (anonymous visitors get sent to /login), which is always safe.
const EXACT = new Set([
	'/login',
	'/signup',
	'/reset-password',
	'/logout',
	'/healthz',
	'/healthz/ready',
	'/manifest.webmanifest',
	'/service-worker.js',
	'/robots.txt',
	'/offline'
]);

// Static asset trees. `/_app/` also carries SvelteKit's internal endpoints; if remote functions
// (`/_app/remote/*`) are ever enabled, re-evaluate this entry, since they would become public.
// Static asset trees: a conservative character set, no dot segments, no doubled slashes.
const ASSET_TREE = /^\/(?:_app|icons|offline)\/[A-Za-z0-9_\-./]+$/;
const FAVICON = /^\/favicon[A-Za-z0-9_\-.]*$/;

export function isPublicPath(pathname: string): boolean {
	// Data requests for a page (`/x/__data.json`) are as public as the page itself.
	const path = pathname.endsWith('/__data.json') ? pathname.slice(0, -'/__data.json'.length) : pathname;
	if (!path.startsWith('/')) return false;

	// Allow one trailing slash on the page routes (SvelteKit redirects it to the canonical URL).
	const bare = path.length > 1 && path.endsWith('/') && !path.endsWith('//') ? path.slice(0, -1) : path;
	if (EXACT.has(bare)) return true;
	if (FAVICON.test(path)) return true;
	return ASSET_TREE.test(path) && !path.includes('..') && !path.includes('//');
}
