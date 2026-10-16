const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * SvelteKit's built-in check only covers form content types. JSON mutations under /api
 * must carry a same-origin Origin header (browsers always send one on cross-site fetches).
 */
export function isForbiddenApiMutation(request: Request, url: URL): boolean {
	if (!MUTATING.has(request.method)) return false;
	if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return false;
	return request.headers.get('origin') !== url.origin;
}
