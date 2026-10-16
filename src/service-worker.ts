/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// App-shell service worker. Pages and API data are per-user and private, so this worker never
// stores them: it precaches only the immutable build assets and shareable static files, and
// otherwise just provides an offline fallback page for navigations. See src/lib/sw/routing.ts
// for the (unit tested) policy on what is intercepted.
import { build, files, version } from '$service-worker';
import { classify } from '$lib/sw/routing';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `kcc-shell-${version}`;
const OFFLINE_PAGE = '/offline/index.html';
const NAVIGATION_TIMEOUT_MS = 5000;

const PRECACHE = [...new Set([...build, ...files])];
const PRECACHED_PATHS: ReadonlySet<string> = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	// No skipWaiting(): a new worker waits until the old tabs are closed, so a running session
	// is never switched to a different build mid-use (its lazily loaded chunks would be gone).
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
	// No clients.claim(): pages opened before the worker existed stay uncontrolled until their
	// next navigation, which keeps first-visit behaviour identical to a site without a worker.
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

async function navigate(request: Request): Promise<Response> {
	// Network first, always: the server must see the document request (session redirects, CSP
	// headers, app_open analytics). The HTML is never cached.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
	try {
		return await fetch(request, { signal: controller.signal });
	} catch {
		const offline = await caches.match(OFFLINE_PAGE, { cacheName: CACHE });
		return offline ?? Response.error();
	} finally {
		clearTimeout(timer);
	}
}

async function asset(request: Request): Promise<Response> {
	const cached = await caches.match(request, { cacheName: CACHE });
	return cached ?? fetch(request);
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const kind = classify(
		{
			method: request.method,
			mode: request.mode,
			url: request.url,
			headers: Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]))
		},
		sw.location.origin,
		PRECACHED_PATHS
	);
	if (kind === 'navigate') event.respondWith(navigate(request));
	else if (kind === 'asset') event.respondWith(asset(request));
});
